const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

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
            return interaction.reply({ content: 'Unauthorized: Command available to owners only.', flags: [MessageFlags.Ephemeral] });
        }

        const shouldUpdate = interaction.options.getBoolean('update') !== false;
        const pm2Name = process.env.PM2_APP_NAME || 'AH-Music';
        
        if (!shouldUpdate) {
            fs.writeFileSync('./.restart_context.json', JSON.stringify({ channelId: interaction.channelId, updated: false, timestamp: Date.now() }));
            await interaction.reply({ content: `✅ **Restarting \`${pm2Name}\`...**`, flags: [MessageFlags.Ephemeral] });
            return exec(`pm2 restart ${pm2Name}`);
        }

        await interaction.reply({ content: '🔍 **Checking for updates...**', flags: [MessageFlags.Ephemeral] });

        // Fetch and compare
        exec('git fetch origin main && git rev-parse HEAD && git rev-parse origin/main', (err, stdout) => {
            if (err) {
                return interaction.followUp({ content: '❌ **Git Check Failed.** Just restarting...', flags: [MessageFlags.Ephemeral] }).then(() => exec(`pm2 restart ${pm2Name}`));
            }

            const revs = stdout.trim().split('\n');
            const localHead = revs[revs.length - 2];
            const remoteHead = revs[revs.length - 1];

            if (localHead === remoteHead) {
                interaction.followUp({ content: '✅ **Code already up-to-date.** Rebuilding neural-activity for consistency...', flags: [MessageFlags.Ephemeral] });
                return exec('npm run build-activity', (buildErr) => {
                    fs.writeFileSync('./.restart_context.json', JSON.stringify({ channelId: interaction.channelId, updated: false, timestamp: Date.now() }));
                    interaction.followUp({ content: '✅ **Build complete. Rebooting system...**', flags: [MessageFlags.Ephemeral] }).then(() => {
                        exec(`pm2 restart ${pm2Name}`);
                    });
                });
            }

            interaction.followUp({ content: '🚀 **Update Found!** Pulling, Installing & Rebuilding...', flags: [MessageFlags.Ephemeral] });

            const updateCommand = `git reset --hard origin/main && npm install && npm run build-activity`;
            
            exec(updateCommand, (buildErr) => {
                if (buildErr) {
                    return interaction.followUp({ content: `❌ **Build Failed**: ${buildErr.message}`, flags: [MessageFlags.Ephemeral] });
                }
                
                // Read the NEW version from the disk after pull
                const newVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../version.json'), 'utf8')).version;

                // Restoring the reboot context for the startup embed
                const context = { channelId: interaction.channelId, updated: true, timestamp: Date.now() };
                fs.writeFileSync('./.restart_context.json', JSON.stringify(context));

                interaction.followUp({ content: `✅ **Update successful (V${newVersion}-AUTONOMY).** Rebooting...`, flags: [MessageFlags.Ephemeral] }).then(() => {
                    exec(`pm2 restart ${pm2Name}`);
                });
            });
        });
    }
};
