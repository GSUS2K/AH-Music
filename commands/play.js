const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, VoiceConnectionStatus, AudioPlayerStatus } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const playDl = require('play-dl');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from any source')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The song URL or search query')
                .setRequired(true)),
    async execute(interaction) {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply({ content: 'You are not connected to a voice channel!', ephemeral: true });
        
        await interaction.deferReply();
        const query = interaction.options.getString('query');

        try {
            let title, thumbnail, author, actualUrl, totalDurationMs, youtubeId;

            // Use play-dl for lightning-fast search (no process spawning)
            try {
                let videoInfo;
                if (query.startsWith('http')) {
                    const info = await playDl.video_info(query);
                    videoInfo = info.video_details;
                } else {
                    const results = await playDl.search(query, { source: { youtube: 'video' }, limit: 1 });
                    videoInfo = results[0];
                }
                if (!videoInfo) throw new Error('No results');
                title = videoInfo.title || 'Unknown Track';
                thumbnail = videoInfo.thumbnails?.[0]?.url || 'https://cdn.discordapp.com/embed/avatars/0.png';
                author = videoInfo.channel?.name || 'Unknown Artist';
                actualUrl = videoInfo.url;
                totalDurationMs = (videoInfo.durationInSec || 0) * 1000;
                youtubeId = videoInfo.id;
            } catch (searchErr) {
                // Fallback to yt-dlp for non-YouTube or failed searches
                console.warn('play-dl search failed, falling back to yt-dlp:', searchErr.message);
                const urlQuery = query.startsWith('http') ? query : `ytsearch1:${query}`;
                const info = await youtubedl(urlQuery, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true }).catch(() => null);
                if (!info) return interaction.followUp("❌ Request failed, could not find the song or it may be private - check the URL.");
                const entry = info.entries ? info.entries[0] : info;
                title = entry.title || 'Unknown Track';
                thumbnail = entry.thumbnail || 'https://cdn.discordapp.com/embed/avatars/0.png';
                author = entry.uploader || 'Unknown Artist';
                actualUrl = entry.webpage_url || query;
                totalDurationMs = (entry.duration || 0) * 1000;
                youtubeId = entry.id;
            }

            const track = { title, thumbnail, author, actualUrl, totalDurationMs, query, requester: interaction.user.id, youtubeId };

            const queueMap = interaction.client.queues;
            let serverQueue = queueMap.get(interaction.guild.id);

            // If a queue exists but the connection is destroyed, clear it and start fresh
            if (serverQueue) {
                const connState = serverQueue.connection?.state?.status;
                const isAlive = connState && connState !== VoiceConnectionStatus.Destroyed;
                if (!isAlive) {
                    console.log('[Queue] Stale queue detected, clearing and restarting...');
                    queueMap.delete(interaction.guild.id);
                    serverQueue = null;
                }
            }

            if (serverQueue) {
                serverQueue.songs.push(track);
                const addEmbed = new EmbedBuilder()
                    .setTitle('Added to Queue')
                    .setDescription(`**[${track.title}](${track.actualUrl})**\nPosition in queue: **${serverQueue.songs.length - 1}**`)
                    .setThumbnail(track.thumbnail)
                    .setColor(0x0099FF);
                return interaction.followUp({ embeds: [addEmbed] });
            }

            const queueConstruct = {
                textChannel: interaction.channel,
                voiceChannel: channel,
                connection: null,
                player: null,
                songs: [track],
                playing: true,
                lastPlayedId: null
            };
            queueMap.set(interaction.guild.id, queueConstruct);

            try {
                const connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: interaction.guild.id,
                    adapterCreator: interaction.guild.voiceAdapterCreator
                });
                await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
                queueConstruct.connection = connection;

                playNextSong(interaction.guild.id, queueMap, interaction);

            } catch (err) {
                console.error(err);
                queueMap.delete(interaction.guild.id);
                return interaction.followUp("❌ Could not join the voice channel.");
            }

        } catch (e) {
            console.error(e);
            return interaction.followUp(`Something went wrong: ${e.message}`);
        }
    }
};


async function fetchSyncedLyrics(trackName, artistName, durationSec) {
    console.log(`[Lyrics] Fetching: "${trackName}" by "${artistName}" (${durationSec}s)`);
    try {
        let artist = artistName.replace(' - Topic', '').trim();
        let track = trackName.replace(/\(.*\)|\[.*\]/g, '').trim();

        // If the title looks like "Artist - Track", split it for better matching
        if (trackName.includes(' - ')) {
            const parts = trackName.split(' - ');
            artist = parts[0].trim();
            track = parts[1].replace(/\(.*\)|\[.*\]/g, '').trim();
        }

        const queryUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}&duration=${Math.floor(durationSec)}`;
        
        let response = await fetch(queryUrl);
        if (response.ok) {
            const data = await response.json();
            if (data.syncedLyrics) return parseLRC(data.syncedLyrics);
        }

        // Search fallback if GET fails
        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${track}`)}`;
        response = await fetch(searchUrl);
        if (response.ok) {
            const results = await response.json();
            // Find first result with synced lyrics and reasonably close duration (within 60s)
            const best = results.find(r => r.syncedLyrics && Math.abs(r.duration - durationSec) < 60);
            if (best) {
                console.log(`[Lyrics] Search fallback found: ${best.trackName} by ${best.artistName}`);
                return parseLRC(best.syncedLyrics);
            }
        }

        return null;
    } catch (error) {
        console.error('[Lyrics] Fetch error:', error.message);
        return null;
    }
}


function parseLRC(lrc) {
    const lines = lrc.split('\n');
    const lyrics = [];
    const timeRegex = /\[(\d+):(\d+\.\d+)\]/;

    for (const line of lines) {
        const match = timeRegex.exec(line);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseFloat(match[2]);
            const timeMs = (minutes * 60 + seconds) * 1000;
            const text = line.split(']').slice(1).join(']').trim();
            if (text) {
                lyrics.push({ time: timeMs, text });
            }
        }
    }
    return lyrics;
}

async function playNextSong(guildId, queueMap, interaction) {
    const queue = queueMap.get(guildId);
    
    if (queue && queue.songs.length === 0 && queue.lastPlayedId) {
        try {
            await queue.textChannel.send({ content: "🔄 Generating the next Up-Next Autoplay track natively..." }).catch(() => null);
            const mixUrl = `https://www.youtube.com/watch?v=${queue.lastPlayedId}&list=RD${queue.lastPlayedId}`;
            const info = await youtubedl(mixUrl, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, playlistItems: '2', extractAudio: true }).catch(() => null);
            
            const entry = info && info.entries ? info.entries[0] : null;
            if (entry && entry.id) {
                queue.songs.push({
                    title: entry.title || "Autoplay Track",
                    thumbnail: entry.thumbnail || 'https://cdn.discordapp.com/embed/avatars/0.png',
                    author: entry.uploader || "YouTube Autoplay",
                    actualUrl: entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}`,
                    totalDurationMs: (entry.duration || 0) * 1000,
                    query: mixUrl,
                    requester: 'Autoplay',
                    youtubeId: entry.id
                });
            }
        } catch (err) {
            console.error("Autoplay generation failed:", err);
        }
    }

    if (!queue || queue.songs.length === 0) {
        if (queue && queue.connection) queue.connection.destroy();
        queueMap.delete(guildId);
        return;
    }

    const track = queue.songs[0];
    queue.lastPlayedId = track.youtubeId;

    const player = createAudioPlayer({
        behaviors: { noSubscriber: 'pause' },
    });
    queue.player = player;
    queue.connection.subscribe(player);

    // Try play-dl first (pure Node.js, instant — no subprocess startup delay)
    // Fall back to yt-dlp pipe if play-dl fails
    let resource;
    try {
        const stream = await playDl.stream(track.actualUrl, { quality: 2 });
        resource = createAudioResource(stream.stream, { inputType: stream.type });
        console.log(`[Stream] play-dl streaming: ${track.title}`);
    } catch (e) {
        console.warn(`[Stream] play-dl failed, using yt-dlp pipe: ${e.message}`);
        const proc = youtubedl.exec(track.actualUrl, {
            o: '-', q: '', f: 'bestaudio/best', 'no-check-certificates': true,
        }, { stdio: ['ignore', 'pipe', 'ignore'] });
        resource = createAudioResource(proc.stdout);
    }

    player.play(resource);

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pause_resume').setLabel('⏯️ Pause / Resume').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('download').setLabel('⬇️ Download').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger)
    );


    const durationStr = `${Math.floor(track.totalDurationMs / 60000)}:${Math.floor((track.totalDurationMs % 60000) / 1000).toString().padStart(2, '0')}`;
    
    // Fetch lyrics early (don't block audio playback)
    let syncedLyrics = null;
    fetchSyncedLyrics(track.title, track.author, track.totalDurationMs / 1000).then(results => {
        syncedLyrics = results;
    }).catch(err => console.warn('[Lyrics] Initial fetch failed:', err.message));

    const generateEmbed = (currentMs) => {
        const totalBars = 25;
        const progress = track.totalDurationMs > 0 ? Math.min(currentMs / track.totalDurationMs, 1) : 0;
        const progressIndex = Math.floor(progress * totalBars);
        
        let bar = '';
        for (let i = 0; i < totalBars; i++) {
            if (i === progressIndex) bar += '🔵';
            else bar += '▬';
        }

        const currentStr = `${Math.floor(currentMs / 60000)}:${Math.floor((currentMs % 60000) / 1000).toString().padStart(2, '0')}`;
        
        const reqValue = track.requester === 'Autoplay' ? '🤖 Autoplay' : `<@${track.requester}>`;

        let description = `**[${track.title}](${track.actualUrl})**\n*by ${track.author}*\n\n\`${currentStr} / ${durationStr}\`\n${bar}`;

        if (syncedLyrics && syncedLyrics.length > 0) {
            const index = syncedLyrics.findLastIndex(l => l.time <= currentMs);
            if (index !== -1) {
                const prev = syncedLyrics[index - 1] ? `\n*${syncedLyrics[index - 1].text}*` : "";
                const current = `\n**${syncedLyrics[index].text}**`;
                const next = syncedLyrics[index + 1] ? `\n*${syncedLyrics[index + 1].text}*` : "";
                description += `\n\n🎵 Lyrics:${prev}${current}${next}`;
            }
        }

        return new EmbedBuilder()
            .setTitle('Now playing')
            .setDescription(description)
            .setThumbnail(track.thumbnail)
            .addFields(
                { name: 'Requested by', value: reqValue, inline: true },
                { name: 'Channel', value: `<#${queue.voiceChannel.id}>`, inline: true }
            )
            .setColor(0x23272A);
    };

    let replyMessage;
    if (interaction) {
         replyMessage = await interaction.followUp({ embeds: [generateEmbed(0)], components: [row], fetchReply: true }).catch(() => null);
    } else {
         replyMessage = await queue.textChannel.send({ embeds: [generateEmbed(0)], components: [row] }).catch(() => null);
    }

    let lastKnownLyricIndex = -1;
    let lastUpdateMs = 0;

    const progressInterval = setInterval(async () => {
        if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
            clearInterval(progressInterval);
            return;
        }
        
        const currentMs = resource.playbackDuration || 0;
        const currentLyricIndex = syncedLyrics ? syncedLyrics.findLastIndex(l => l.time <= currentMs) : -1;

        if (player.state.status === 'playing' && replyMessage) {
            // Update only if local lyric line changed OR 5 seconds passed since last progress bar update
            if (currentLyricIndex !== lastKnownLyricIndex || (currentMs - lastUpdateMs) >= 5000) {
                lastKnownLyricIndex = currentLyricIndex;
                lastUpdateMs = currentMs;
                try {
                    await replyMessage.edit({ embeds: [generateEmbed(currentMs)] });
                } catch (err) {
                    clearInterval(progressInterval);
                }
            }
        }
    }, 1000);

    player.on(AudioPlayerStatus.Idle, () => {
        clearInterval(progressInterval);
        queue.songs.shift(); 
        playNextSong(guildId, queueMap, null);
    });
}
