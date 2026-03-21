const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const playDl = require('play-dl');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('radio')
        .setDescription('Start a 24/7 live radio — use a URL or search by keyword (e.g. lofi, jazz, synthwave)')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('YouTube Live URL or a keyword like "lofi", "jazz radio", etc.')
                .setRequired(true)),
    async execute(interaction) {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply({ content: 'You are not connected to a voice channel!', ephemeral: true });
        
        await interaction.deferReply();
        const input = interaction.options.getString('query');

        try {
            let streamUrl = input;

            // If not a URL, search YouTube for a matching live stream
            if (!input.startsWith('http')) {
                await interaction.editReply({ content: `🔍 Searching for a live stream matching **${input}**...` });
                try {
                    const results = await playDl.search(`${input} live`, {
                        source: { youtube: 'video' },
                        limit: 5
                    });
                    // Prefer actual live streams, otherwise take first result
                    const liveResult = results.find(r => r.live) || results[0];
                    if (!liveResult) throw new Error('No results found');
                    streamUrl = liveResult.url;
                    console.log(`[Radio] Found stream via play-dl search: ${liveResult.title} (${streamUrl})`);
                } catch (searchErr) {
                    console.warn('[Radio] play-dl search failed:', searchErr.message);
                    // Fallback: use yt-dlp ytsearch for live
                    const info = await youtubedl(`ytsearch1:${input} live stream`, {
                        dumpSingleJson: true, noCheckCertificates: true, noWarnings: true
                    }).catch(() => null);
                    if (!info) return interaction.editReply({ content: '❌ Could not find a live stream for that query.' });
                    streamUrl = info.webpage_url || info.url;
                }
            }

            const info = await youtubedl(streamUrl, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true }).catch(() => null);
            const title = info?.title || input;
            const author = info?.uploader || 'Unknown Channel';
            const thumbnail = info?.thumbnail || 'https://cdn.discordapp.com/embed/avatars/0.png';

            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

            const player = createAudioPlayer({
                behaviors: {
                    noSubscriber: 'pause',
                },
            });
            connection.subscribe(player);
            
            const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
            const { spawn } = require('child_process');

            const startRadioStream = async (url) => {
                const { StreamType } = require('@discordjs/voice');
                
                // Try play-dl first (same logic as play.js which we know works)
                try {
                    console.log(`[Radio] play-dl attempt: ${url}`);
                    const stream = await playDl.stream(url, { quality: 2 });
                    return createAudioResource(stream.stream, { inputType: stream.type });
                } catch (playDlErr) {
                    console.warn(`[Radio] play-dl failed: ${playDlErr.message}`);
                }

                // Fallback: ffmpeg to Opus (native Discord format)
                try {
                    console.log(`[Radio] ffmpeg-opus fallback: ${url}`);
                    // We can use yt-dlp to get the best audio URL then pipe to ffmpeg
                    const manifestUrl = await youtubedl(url, {
                        f: 'bestaudio/best', getUrl: true, noCheckCertificates: true, noWarnings: true,
                    }).catch(() => url);

                    const ffmpeg = spawn(ffmpegPath, [
                        '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
                        '-i', manifestUrl.trim(),
                        '-vn',
                        '-acodec', 'libopus',
                        '-f', 'opus',
                        '-ar', '48000',
                        '-ac', '2',
                        'pipe:1'
                    ], { stdio: ['ignore', 'pipe', 'pipe'] });

                    ffmpeg.stderr.on('data', (d) => {
                        const m = d.toString();
                        if (m.includes('Error') || m.includes('fail')) console.error(`[Radio FFMPEG] ${m}`);
                    });

                    return createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus });
                } catch (err) {
                    console.error(`[Radio] All fallbacks failed: ${err.message}`);
                    return null;
                }
            };

            const resource = await startRadioStream(streamUrl);
            player.play(resource);

            player.on(AudioPlayerStatus.Idle, async () => {
                try {
                    player.play(await startRadioStream(streamUrl));
                } catch(e) {
                    console.error("Radio Stream Restart Failed:", e);
                }
            });

            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('pause_resume')
                        .setLabel('⏯️ Pause / Resume')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('stop')
                        .setLabel('⏹️ Stop')
                        .setStyle(ButtonStyle.Danger)
                );

            let position = 0;
            let direction = 1;
            const totalBars = 25;

            const generateEmbed = () => {
                let bar = '';
                for (let i = 0; i < totalBars; i++) {
                    if (i === position) bar += '🔵';
                    else bar += '▬';
                }
                
                position += direction;
                if (position >= totalBars - 1) direction = -1;
                if (position <= 0) direction = 1;

                return new EmbedBuilder()
                    .setTitle('Live Radio')
                    .setDescription(`**[${title}](${streamUrl})**\n*by ${author}*\n\n\`🔴 LIVE\` ${bar}`)
                    .setThumbnail(thumbnail)
                    .addFields(
                        { name: 'Requested by', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Channel', value: `<#${channel.id}>`, inline: true }
                    )
                    .setColor(0x23272A);
            };

            const replyMessage = await interaction.followUp({ embeds: [generateEmbed()], components: [row], fetchReply: true });

            const progressInterval = setInterval(async () => {
                if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
                    clearInterval(progressInterval);
                    return;
                }
                if (player.state.status === 'playing') {
                    try {
                        await replyMessage.edit({ embeds: [generateEmbed()] });
                    } catch (err) {
                        clearInterval(progressInterval);
                    }
                }
            }, 4_000);

        } catch (e) {
            console.error(e);
            return interaction.followUp(`Something went wrong: ${e.message}`);
        }
    }
};
