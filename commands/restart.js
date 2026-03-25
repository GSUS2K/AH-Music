const { SlashCommandBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');

const OWNER_ID = '682288992456409096';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Restart the bot (Owner only)'),
    async execute(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
        }

        await interaction.reply({ content: 'Initiating process refresh sequence...', ephemeral: true });
        
        // Trigger actual restart via PM2
        exec('pm2 restart AH-Music', (pm2Err, stdout, stderr) => {
            if (pm2Err) {
                console.error('[Restart] PM2 Failure:', pm2Err.message);
                return interaction.followUp({ content: `❌ Critical Error: ${pm2Err.message}`, ephemeral: true });
            }
            console.log('[Restart] PM2 Success:', stdout);
        });
    }
};
