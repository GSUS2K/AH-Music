```javascript
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Control lyric display and sync')
        .addSubcommand(subcommand =>
            subcommand
                .setName('offset')
                .setDescription('Manually offset the lyric sync (in seconds)')
                .addNumberOption(option => 
                    option.setName('seconds')
                        .setDescription('Seconds to offset (positive = delay lyrics, negative = earlier lyrics)')
                        .setRequired(true))),
    async execute(interaction) {
        const queueMap = interaction.client.queues;
        const serverQueue = queueMap.get(interaction.guild.id);

        if (!serverQueue || !serverQueue.songs.length) {
            return interaction.reply({ content: '❌ Nothing is currently playing!', flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.options.getSubcommand() === 'offset') {
            const seconds = interaction.options.getNumber('seconds');
            serverQueue.lyricOffsetMs = seconds * 1000;
            
            return interaction.reply({ 
                content: `✅ Lyric offset set to **${seconds}s**. (Note: The next embed update will reflect this)` 
            });
        }
    },
};
