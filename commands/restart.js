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

        await interaction.reply({ content: 'Initiating deployment sequence...', ephemeral: true });
        
        exec('git pull', (err, stdout, stderr) => {
            const isUpdated = err ? false : !stdout.includes('Already up to date');
            
            // Save context with update status
            try {
                fs.writeFileSync('./.restart_context.json', JSON.stringify({
                    channelId: interaction.channelId,
                    updated: isUpdated,
                    timestamp: Date.now()
                }));
            } catch (fsErr) {
                console.error('[Restart] Failed to save context:', fsErr.message);
            }

            console.log('[Restart] Pull Result:', stdout || stderr);

            // Trigger actual restart
            exec('pm2 restart AH-Music', (pm2Err) => {
                if (pm2Err) console.error('[Restart] PM2 Failure:', pm2Err.message);
            });
        });
    }
};
