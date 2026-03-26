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

        await interaction.reply({ content: '🚀 **Update & Reset Sequence Initiated**\n- Cleaning local environment...\n- Pulling latest nebula-code (Hard Reset)...\n- Rebuilding neural-activity (Vite)...\n- Refreshing PM2 process...', ephemeral: true });
        
        const pm2Name = process.env.PM2_APP_NAME || 'AH-Music';
        
        // Force a hard reset to match origin/main and then rebuild the frontend
        const updateCommand = `git fetch --all && git reset --hard origin/main && npm run build-activity`;
        
        console.log(`[Restart] Initiating update for ${pm2Name}...`);
        
        exec(updateCommand, (err, stdout, stderr) => {
            if (err) {
                console.error('[Restart] Critical Failure:', err.message);
                return interaction.followUp({ content: `❌ **Sequence Aborted**: ${err.message}\n\`\`\`${stderr.substring(0, 500)}\`\`\``, ephemeral: true });
            }
            
            const buildSuccess = stdout.includes('built in') || stdout.includes('successfully');
            const statusMsg = buildSuccess ? '✅ **Latest changes pulled and rebuilt successfully.**' : '⚠️ **Pull complete, but build output was ambiguous. Restarting anyway...**';
            
            console.log(`[Restart] Build Output:\n${stdout.substring(stdout.length - 1000)}`);

            interaction.followUp({ content: `${statusMsg}\n- Version: \`v3.2-QUEUED\`\n- Restarting \`${pm2Name}\` now...`, ephemeral: true }).then(() => {
                // Final step: Restart the PM2 process
                exec(`pm2 restart ${pm2Name}`, (restErr) => {
                    if (restErr) console.error('[Restart] PM2 Failure:', restErr.message);
                });
            });
        });
    }
};
