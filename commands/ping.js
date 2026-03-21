const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check the bot\'s latency and status'),
    async execute(interaction) {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true, ephemeral: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(interaction.client.ws.ping);

        interaction.editReply({
            content: `🚀 **Pong!**\n\n📡 Latency: **${latency}ms**\n🌐 API Latency: **${apiLatency}ms**\n✅ Bot is running smoothly!`,
            ephemeral: true
        });
    },
};
