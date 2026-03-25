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

        await interaction.reply({ content: '🚀 **Update & Reset Sequence Initiated**\n- Pulling latest nebula-code...\n- Rebuilding neural-activity...\n- Refreshing process...', ephemeral: true });
        
        const command = 'git pull origin main && npm run build-activity && pm2 restart AH-Music';
        
        exec(command, (err, stdout, stderr) => {
            if (err) {
                console.error('[Restart] Failure:', err.message);
                return interaction.followUp({ content: `❌ **Sequence Aborted**: ${err.message}`, ephemeral: true });
            }
            console.log('[Restart] Success:', stdout);
        });
    }
};
