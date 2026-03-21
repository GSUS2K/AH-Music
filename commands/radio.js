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
            
            const startYtdl = (url) => {
                const proc = youtubedl.exec(url, {
                    o: '-', q: '', f: 'bestaudio/best', 'no-check-certificates': true,
                }, { stdio: ['ignore', 'pipe', 'ignore'] });
                return proc.stdout;
            };

            const playDl = require('play-dl');

            const getResource = async (url) => {
                try {
                    const stream = await playDl.stream(url);
                    return createAudioResource(stream.stream, { inputType: stream.type });
                } catch (e) {
                    console.warn("Radio: play-dl failed, falling back to yt-dlp:", e.message);
                    return createAudioResource(startYtdl(url));
                }
            };

            const resource = await getResource(query);
            player.play(resource);

            player.on(AudioPlayerStatus.Idle, async () => {
                try {
                    player.play(await getResource(query));
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
