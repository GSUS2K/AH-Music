const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the current song'),
    async execute(interaction) {
        await interaction.deferReply();
        const connection = getVoiceConnection(interaction.guild.id);
        if (!connection || !connection.state.subscription) {
            return interaction.followUp("❌ I'm not currently playing anything!");
        }
        connection.state.subscription.player.pause();
        return interaction.followUp("⏸️ **Paused the music.**");
    }
};
