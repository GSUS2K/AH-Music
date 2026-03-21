const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { exec } = require('child_process');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Restart the bot (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        await interaction.reply({ content: 'Restarting bot...', ephemeral: true });

        exec('pm2 restart AH-Music', (err) => {
            if (err) console.error('[Restart] Failed:', err.message);
        });
    }
};
