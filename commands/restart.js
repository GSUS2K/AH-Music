const { SlashCommandBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');

const OWNER_ID = process.env.OWNER_ID || '682288992456409096';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Restart the bot (Owner only)'),
    async execute(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
        }

        await interaction.reply({ content: '🚀 **Update & Reset Sequence Initiated**\n- Pulling latest nebula-code...\n- Rebuilding neural-activity...\n- Refreshing process...', ephemeral: true });
        
        const pm2Name = process.env.PM2_APP_NAME || 'AH-Music';
        
        // Use a single exec to handle the sequence and report progress
        const pullAndBuild = `git pull origin main && npm run build-activity`;
        
        exec(pullAndBuild, (err, stdout, stderr) => {
            if (err) {
                console.error('[Restart] Build Failure:', err.message);
                return interaction.followUp({ content: `❌ **Sequence Aborted during Build**: ${err.message}`, ephemeral: true });
            }
            
            // Check if git actually pulled anything
            const isUpToDate = stdout.includes('Already up to date');
            const statusMsg = isUpToDate ? '✅ **Code is already up to date.**' : '✅ **Latest changes pulled and rebuilt.**';
            
            interaction.followUp({ content: `${statusMsg} Restarting process \`${pm2Name}\` now...`, ephemeral: true }).then(() => {
                // Final step: Restart the PM2 process
                exec(`pm2 restart ${pm2Name}`, (restErr) => {
                    if (restErr) console.error('[Restart] PM2 Failure:', restErr.message);
                });
            });
        });
    }
};
