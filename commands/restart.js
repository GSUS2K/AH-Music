const { SlashCommandBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');

const OWNER_ID = process.env.OWNER_ID || '682288992456409096';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Restart the bot or pull latest updates')
        .addBooleanOption(option => 
            option.setName('update')
                .setDescription('Pull latest changes from GitHub & Rebuild (default: true)')
                .setRequired(false)),
    async execute(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: 'Unauthorized: Command available to owners only.', ephemeral: true });
        }

        const shouldUpdate = interaction.options.getBoolean('update') !== false;
        const pm2Name = process.env.PM2_APP_NAME || 'AH-Music';
        
        if (!shouldUpdate) {
            fs.writeFileSync('./.restart_context.json', JSON.stringify({ channelId: interaction.channelId, updated: false, timestamp: Date.now() }));
            await interaction.reply({ content: `✅ **Restarting \`${pm2Name}\`...**`, ephemeral: true });
            return exec(`pm2 restart ${pm2Name}`);
        }

        await interaction.reply({ content: '🔍 **Checking for updates...**', ephemeral: true });

        // Fetch and compare
        exec('git fetch origin main && git rev-parse HEAD && git rev-parse origin/main', (err, stdout) => {
            if (err) {
                return interaction.followUp({ content: '❌ **Git Check Failed.** Just restarting...', ephemeral: true }).then(() => exec(`pm2 restart ${pm2Name}`));
            }

            const revs = stdout.trim().split('\n');
            const localHead = revs[revs.length - 2];
            const remoteHead = revs[revs.length - 1];

            if (localHead === remoteHead) {
                interaction.followUp({ content: '✅ **Code already up-to-date.** Rebuilding neural-activity for consistency...', ephemeral: true });
                return exec('npm run build-activity', (buildErr) => {
                    fs.writeFileSync('./.restart_context.json', JSON.stringify({ channelId: interaction.channelId, updated: false, timestamp: Date.now() }));
                    interaction.followUp({ content: '✅ **Build complete. Rebooting system...**', ephemeral: true }).then(() => {
                        exec(`pm2 restart ${pm2Name}`);
                    });
                });
            }

            interaction.followUp({ content: '🚀 **Update Found!** Pulling & Rebuilding neural-activity...', ephemeral: true });

            const updateCommand = `git reset --hard origin/main && npm run build-activity`;
            
            exec(updateCommand, (buildErr) => {
                if (buildErr) {
                    return interaction.followUp({ content: `❌ **Build Failed**: ${buildErr.message}`, ephemeral: true });
                }
                
                // Write context for startup msg
                const context = { channelId: interaction.channelId, updated: true, timestamp: Date.now() };
                fs.writeFileSync('./.restart_context.json', JSON.stringify(context));

                interaction.followUp({ content: '✅ **Update successful.** Rebooting...', ephemeral: true }).then(() => {
                    exec(`pm2 restart ${pm2Name}`);
                });
            });
        });
    }
};
