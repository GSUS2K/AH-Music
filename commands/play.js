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

    // Stream audio via yt-dlp pipe (most compatible approach)
    const proc = youtubedl.exec(track.actualUrl, {
        o: '-', q: '', f: 'bestaudio/best', 'no-check-certificates': true,
    }, { stdio: ['ignore', 'pipe', 'ignore'] });
    const resource = createAudioResource(proc.stdout);

    player.play(resource);

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pause_resume').setLabel('⏯️ Pause / Resume').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('download').setLabel('⬇️ Download').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger)
    );

    const durationStr = `${Math.floor(track.totalDurationMs / 60000)}:${Math.floor((track.totalDurationMs % 60000) / 1000).toString().padStart(2, '0')}`;
    
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

        return new EmbedBuilder()
            .setTitle('Now playing')
            .setDescription(`**[${track.title}](${track.actualUrl})**\n*by ${track.author}*\n\n\`${currentStr} / ${durationStr}\`\n${bar}`)
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

    const progressInterval = setInterval(async () => {
        if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
            clearInterval(progressInterval);
            return;
        }
        if (player.state.status === 'playing' && replyMessage) {
            try {
                await replyMessage.edit({ embeds: [generateEmbed(resource.playbackDuration)] });
            } catch (err) {
                clearInterval(progressInterval);
            }
        }
    }, 4_000);

    player.on(AudioPlayerStatus.Idle, () => {
        clearInterval(progressInterval);
        queue.songs.shift(); 
        playNextSong(guildId, queueMap, null);
    });
}
