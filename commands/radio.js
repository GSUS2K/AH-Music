const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('radio')
        .setDescription('Start a 24/7 continuous stream (e.g. Lofi)')
        .addStringOption(option => 
            option.setName('url')
                .setDescription('The URL of the continuous stream (e.g. YouTube Live)')
                .setRequired(true)),
    async execute(interaction) {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply({ content: 'You are not connected to a voice channel!', ephemeral: true });
        
        await interaction.deferReply();
        const query = interaction.options.getString('url');

        try {
            const info = await youtubedl(query, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true }).catch(() => null);
            const title = info?.title || "YouTube Live Stream";
            const author = info?.uploader || "Unknown Channel";
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
                // Step 1: Get the real HLS/manifest URL from yt-dlp
                const manifestResult = await youtubedl(url, {
                    f: 'bestaudio/best',
                    getUrl: true,
                    noCheckCertificates: true,
                    noWarnings: true,
                }).catch(() => null);

                const manifestUrl = typeof manifestResult === 'string'
                    ? manifestResult.trim().split('\n')[0]
                    : null;

                if (manifestUrl) {
                    // Step 2: Pipe the HLS stream through ffmpeg for proper decoding
                    const ffmpeg = spawn(ffmpegPath, [
                        '-reconnect', '1',
                        '-reconnect_streamed', '1',
                        '-reconnect_delay_max', '5',
                        '-i', manifestUrl,
                        '-vn',              // no video
                        '-acodec', 'libopus',
                        '-f', 'opus',
                        '-ar', '48000',
                        '-ac', '2',
                        'pipe:1'
                    ], { stdio: ['ignore', 'pipe', 'ignore'] });

                    return createAudioResource(ffmpeg.stdout, { inputType: require('@discordjs/voice').StreamType.OggOpus });
                }

                // Fallback: pipe yt-dlp stdout directly
                console.warn("Radio: No manifest URL, falling back to yt-dlp pipe");
                const proc = youtubedl.exec(url, {
                    o: '-', q: '', f: 'bestaudio/best', 'no-check-certificates': true,
                }, { stdio: ['ignore', 'pipe', 'ignore'] });
                return createAudioResource(proc.stdout);
            };

            const resource = await startRadioStream(query);
            player.play(resource);

            player.on(AudioPlayerStatus.Idle, async () => {
                try {
                    player.play(await startRadioStream(query));
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
                    .setDescription(`**[${title}](${query})**\n*by ${author}*\n\n\`🔴 LIVE\` ${bar}`)
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
