const { SlashCommandBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');

const OWNER_ID = process.env.OWNER_ID || '682288992456409096';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Pull latest neural-code and rebuild the activity'),
    async execute(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: 'Unauthorized: Command available to owners only.', ephemeral: true });
        }

        const pm2Name = process.env.PM2_APP_NAME || 'AH-Music';
        
        await interaction.reply({ content: '🔍 **Scanning for neural-updates...**', ephemeral: true });

        // Git fetch and compare
        exec('git fetch origin main && git rev-parse HEAD && git rev-parse origin/main', (err, stdout) => {
            if (err) {
                return interaction.followUp({ content: '❌ **Neural Scan Failed.** Manual restart recommended.', ephemeral: true });
            }

            const revs = stdout.trim().split('\n');
            const localHead = revs[revs.length - 2];
            const remoteHead = revs[revs.length - 1];

            if (localHead === remoteHead) {
                return interaction.followUp({ content: '✅ **Neural-code is already up-to-date.** No rebuild required.', ephemeral: true });
            }

            interaction.followUp({ content: '🚀 **Update Found!** Pulling & Rebuilding neural-activity...', ephemeral: true });

            const updateCommand = `git reset --hard origin/main && npm run build-activity`;
            
            exec(updateCommand, (buildErr) => {
                if (buildErr) {
                    return interaction.followUp({ content: `❌ **Neural Build Failed**: ${buildErr.message}`, ephemeral: true });
                }
                
                // Write context for startup msg
                const context = { channelId: interaction.channelId, updated: true, timestamp: Date.now() };
                fs.writeFileSync('./.restart_context.json', JSON.stringify(context));

                interaction.followUp({ content: '✅ **Update successful.** Rebooting system...', ephemeral: true }).then(() => {
                    exec(`pm2 restart ${pm2Name}`);
                });
            });
        });
    }
};
