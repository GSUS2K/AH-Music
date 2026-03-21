const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song and play the next one'),
    async execute(interaction) {
        await interaction.deferReply();
        const connection = getVoiceConnection(interaction.guild.id);
        if (!connection || !connection.state.subscription) {
            return interaction.followUp("❌ I'm not currently playing anything!");
        }
        // Stop the current track — this triggers the Idle event which loads the next song
        connection.state.subscription.player.stop();
        return interaction.followUp("⏭️ **Skipped! Loading next track...**");
    }
};
