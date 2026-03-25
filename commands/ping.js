const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check the bot\'s latency and status'),
    async execute(interaction) {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true, ephemeral: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = interaction.client.ws.ping;
        const apiLatencyStr = apiLatency === -1 ? 'Calculating...' : `${apiLatency}ms`;

        const embed = new EmbedBuilder()
            .setTitle('🛰️ Sʏsᴛᴇᴍ Lᴀᴛᴇɴᴄʏ')
            .setColor(0x2B2D31)
            .addFields(
                { name: '📡 Connection', value: `\`${latency}ms\``, inline: true },
                { name: '🌐 API Gateway', value: `\`${apiLatencyStr}\``, inline: true }
            )
            .setFooter({ text: 'Status: Optimized & Stable' });

        await interaction.editReply({
            content: '',
            embeds: [embed],
            ephemeral: true
        });
    },
};
