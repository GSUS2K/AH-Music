const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const playDl = require('play-dl');
const youtubedl = require('youtube-dl-exec');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from YouTube or SoundCloud')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The song title or URL')
                .setRequired(true)),
    async execute(interaction) {
        const query = interaction.options.getString('query');
        return this.handlePlay(interaction, query);
    },

    async handlePlay(interaction, query) {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply({ content: 'You are not connected to a voice channel!', ephemeral: true });

        if (interaction.deferred || interaction.replied) {
            // Already handled
        } else {
            await interaction.deferReply();
        }

        try {
            let track = null;
            
            // 1. Search for the track
            if (query.startsWith('http')) {
                const info = await youtubedl(query, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true }).catch(() => null);
                if (info) {
                    track = {
                        title: info.title || "Unknown Track",
                        thumbnail: info.thumbnail || 'https://cdn.discordapp.com/embed/avatars/0.png',
                        author: info.uploader || "Unknown Artist",
                        actualUrl: info.webpage_url || query,
                        totalDurationMs: (info.duration || 0) * 1000,
                        query: query,
                        requester: interaction.user.id,
                        youtubeId: info.id
                    };
                }
            } else {
                const results = await playDl.search(query, { limit: 1 });
                if (results.length > 0) {
                    const res = results[0];
                    track = {
                        title: res.title,
                        thumbnail: res.thumbnails[0]?.url,
                        author: res.channel?.name || "Unknown Artist",
                        actualUrl: res.url,
                        totalDurationMs: res.durationInSec * 1000,
                        query: query,
                        requester: interaction.user.id,
                        youtubeId: res.id
                    };
                }
            }

            if (!track) return interaction.followUp("Request failed - check the URL or try a search term.");

            // 2. Identify Chapters (for auto-offset)
            try {
                const info = await youtubedl(track.actualUrl, { dumpSingleJson: true, noCheckCertificates: true }).catch(() => null);
                if (info && info.chapters && info.chapters.length > 0) {
                    const firstChapter = info.chapters[0];
                    if (firstChapter.title.toLowerCase().includes('intro') || firstChapter.start_time === 0) {
                         if (info.chapters.length > 1) track.introOffsetMs = info.chapters[1].start_time * 1000;
                    }
                }
            } catch (e) { /* ignore */ }

            const queueMap = interaction.client.queues;
            let serverQueue = queueMap.get(interaction.guild.id);

            if (serverQueue) {
                serverQueue.songs.push(track);
                const addEmbed = new EmbedBuilder()
                    .setTitle('Added to Queue')
                    .setDescription(`**[${track.title}](${track.actualUrl})**\nPosition: **${serverQueue.songs.length - 1}**`)
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
                lastPlayedId: null,
                lyricOffsetMs: 0
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
                return interaction.followUp("Could not join the voice channel.");
            }

        } catch (e) {
            console.error(e);
            return interaction.followUp(`Something went wrong: ${e.message}`);
        }
    }
};

async function fetchYouTubeSubtitles(videoUrl) {
    try {
        const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
        console.log(`[Lyrics] Checking YouTube captions for: ${videoUrl}`);
        
        const info = await youtubedl(videoUrl, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            ffmpegLocation: ffmpegPath
        }).catch(() => null);

        if (!info || !info.subtitles) return null;

        const subs = info.subtitles.en || info.automatic_captions?.en;
        if (!subs) return null;

        const vttUrl = subs.find(s => s.ext === 'vtt' || s.ext === 'json3')?.url;
        if (!vttUrl) return null;

        const response = await fetch(vttUrl);
        if (!response.ok) return null;
        const content = await response.text();

        console.log(`[Lyrics] YouTube captions found`);
        return parseVTT(content);
    } catch (e) {
        console.error('[Lyrics] YouTube subtitle error:', e.message);
        return null;
    }
}

function parseVTT(vttContent) {
    const lines = vttContent.split('\n');
    const lyrics = [];
    let currentItem = null;

    for (const line of lines) {
        const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/);
        if (timeMatch) {
            const start = timeMatch[1];
            const [hh, mm, ss] = start.split(':');
            const timeMs = (parseInt(hh) * 3600 + parseInt(mm) * 60 + parseFloat(ss)) * 1000;
            currentItem = { time: timeMs, text: '' };
        } else if (currentItem && line.trim() && !line.match(/^[0-9]+$/)) {
            currentItem.text = line.trim().replace(/<[^>]*>/g, '');
            lyrics.push(currentItem);
            currentItem = null;
        }
    }
    return lyrics;
}

async function fetchSyncedLyrics(trackName, artistName, durationSec, originalQuery, videoUrl) {
    try {
        const clean = (s) => s.split('(')[0].split('[')[0].split('-')[0].split('ft.')[0].trim();
        const t = clean(trackName);
        const a = clean(artistName);

        // 1. Try direct LRCLIB search
        const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}&duration=${Math.floor(durationSec)}`;
        let response = await fetch(searchUrl);
        if (response.ok) {
            const results = await response.json();
            const best = results
                .filter(r => r.syncedLyrics && Math.abs(r.duration - durationSec) < 60)
                .sort((a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec))[0];
            if (best) return { lyrics: parseLRC(best.syncedLyrics) };
        }

        // 2. Try simple search fallback
        const simpleUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(t + ' ' + a)}`;
        response = await fetch(simpleUrl);
        if (response.ok) {
            const results = await response.json();
            const best = results
                .filter(r => r.syncedLyrics && Math.abs(r.duration - durationSec) < 60)
                .sort((a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec))[0];
            if (best) return { lyrics: parseLRC(best.syncedLyrics) };
        }

        // 3. Try YouTube Subtitles
        const ytSubs = await fetchYouTubeSubtitles(videoUrl);
        if (ytSubs) return { lyrics: ytSubs };

        return null;
    } catch (error) {
        console.error('[Lyrics] Fetch error:', error.message);
        return null;
    }
}

function parseLRC(lrcContent) {
    const lines = lrcContent.split('\n');
    const lyrics = [];
    for (const line of lines) {
        const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
        if (match) {
            const mm = parseInt(match[1]);
            const ss = parseInt(match[2]);
            const ms = parseInt(match[3].padEnd(3, '0'));
            const timeMs = mm * 60000 + ss * 1000 + ms;
            const text = match[4].trim();
            if (text) lyrics.push({ time: timeMs, text });
        }
    }
    return lyrics;
}

async function playNextSong(guildId, queueMap, interaction) {
    const queue = queueMap.get(guildId);
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

    const isLive = track.totalDurationMs === 0;
    let resource;

    // Simplified fallback streaming (Proven on VM)
    try {
        const stream = await playDl.stream(track.actualUrl, { quality: isLive ? undefined : 2 });
        resource = createAudioResource(stream.stream, { inputType: stream.type });
    } catch (e) {
        console.warn(`[Stream] play-dl failed, using yt-dlp fallback: ${e.message}`);
        const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
        const proc = youtubedl.exec(track.actualUrl, {
            o: '-', q: '', f: 'bestaudio/best', 'no-check-certificates': true,
            ffmpegLocation: ffmpegPath
        }, { stdio: ['ignore', 'pipe', 'ignore'] });
        resource = createAudioResource(proc.stdout);
    }

    player.play(resource);

    player.on('error', error => console.error(`[Player Error] ${error.message}`));
    player.on('stateChange', (oldState, newState) => {
        if (newState.status !== oldState.status) console.log(`[Player Status] ${oldState.status} -> ${newState.status}`);
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pause_resume').setLabel('Pause / Resume').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('skip').setLabel('Skip').setStyle(ButtonStyle.Secondary)
    );

    if (!isLive) {
        row.addComponents(new ButtonBuilder().setCustomId('download').setLabel('Download').setStyle(ButtonStyle.Success));
    }

    row.addComponents(new ButtonBuilder().setCustomId('stop').setLabel('Stop').setStyle(ButtonStyle.Danger));

    const durationStr = isLive ? 'LIVE' : `${Math.floor(track.totalDurationMs / 60000)}:${Math.floor((track.totalDurationMs % 60000) / 1000).toString().padStart(2, '0')}`;
    
    let syncedLyrics = null;
    if (!isLive) {
        fetchSyncedLyrics(track.title, track.author, track.totalDurationMs / 1000, track.query, track.actualUrl)
            .then(res => syncedLyrics = res)
            .catch(err => console.warn('[Lyrics] Fetch failed:', err.message));
    }

    const generateEmbed = (currentMs) => {
        const totalBars = 25;
        const progress = track.totalDurationMs > 0 ? Math.min(currentMs / track.totalDurationMs, 1) : 0;
        const progressIndex = Math.floor(progress * totalBars);
        let bar = '';
        for (let i = 0; i < totalBars; i++) bar += (i === progressIndex) ? '🔵' : '▬';

        const currentStr = `${Math.floor(currentMs / 60000)}:${Math.floor((currentMs % 60000) / 1000).toString().padStart(2, '0')}`;
        let description = `**[${track.title}](${track.actualUrl})**\n*by ${track.author}*\n\n\`${currentStr} / ${durationStr}\`\n${bar}`;

        if (syncedLyrics && syncedLyrics.lyrics && syncedLyrics.lyrics.length > 0) {
            const offsetMs = (track.introOffsetMs || 0) + (queue.lyricOffsetMs || 0);
            const adjustedMs = currentMs - offsetMs;
            const lines = syncedLyrics.lyrics;
            const index = lines.findLastIndex(l => l.time <= adjustedMs);
            if (index !== -1) {
                const prev = lines[index - 1] ? `\n*${lines[index - 1].text}*` : "";
                const current = `\n**${lines[index].text}**`;
                const next = lines[index + 1] ? `\n*${lines[index + 1].text}*` : "";
                description += `\n\n🎵 Lyrics:${prev}${current}${next}`;
            } else if (adjustedMs < 0) {
                description += `\n\n🎵 Lyrics:\n*... Intro ...*`;
            }
        }

        return new EmbedBuilder()
            .setTitle('Now playing')
            .setDescription(description)
            .setThumbnail(track.thumbnail)
            .addFields(
                { name: 'Requested by', value: track.requester === 'Autoplay' ? '🤖 Autoplay' : `<@${track.requester}>`, inline: true },
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
        const currentLyricIndex = (syncedLyrics && syncedLyrics.lyrics) 
            ? syncedLyrics.lyrics.findLastIndex(l => l.time <= currentMs - ((track.introOffsetMs || 0) + (queue.lyricOffsetMs || 0))) 
            : -1;

        if (player.state.status === 'playing' && replyMessage) {
            if (currentLyricIndex !== lastKnownLyricIndex || (currentMs - lastUpdateMs) >= 5000) {
                lastKnownLyricIndex = currentLyricIndex;
                lastUpdateMs = currentMs;
                try { await replyMessage.edit({ embeds: [generateEmbed(currentMs)] }); } catch (err) { clearInterval(progressInterval); }
            }
        }
    }, 1000);

    player.on(AudioPlayerStatus.Idle, () => {
        clearInterval(progressInterval);
        queue.songs.shift(); 
        playNextSong(guildId, queueMap, null);
    });
}
