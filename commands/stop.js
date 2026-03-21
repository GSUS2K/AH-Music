const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the music and leave the channel'),
    async execute(interaction) {
        await interaction.deferReply();
        const connection = getVoiceConnection(interaction.guild.id);
        if (!connection) {
            return interaction.followUp("❌ I'm not currently playing anything!");
        }
        connection.destroy();
        return interaction.followUp("🛑 **Stopped the stream and left the channel!**");
    }
};
