const { SlashCommandBuilder } = require('discord.js');
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
            return interaction.reply({ content: 'Unauthorized: Command available to owners only.', ephemeral: true });
        }

        const shouldUpdate = interaction.options.getBoolean('update') !== false;
        const pm2Name = process.env.PM2_APP_NAME || 'AH-Music';
        
        // Write restart context for index.js to pick up after reboot
        const context = {
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            updated: shouldUpdate,
            timestamp: Date.now()
        };
        fs.writeFileSync('./.restart_context.json', JSON.stringify(context));

        if (!shouldUpdate) {
            await interaction.reply({ content: `✅ **Simple Restart Initiated**\n- Writing context...\n- Restarting \`${pm2Name}\` process...`, ephemeral: true });
            return exec(`pm2 restart ${pm2Name}`, (err) => {
                if (err) console.error('[Restart] PM2 error:', err.message);
            });
        }

        await interaction.reply({ 
            content: '🚀 **Full Update & Rebuild Sequence Initiated**\n- Pulling latest nebula-code (Reset)...\n- Rebuilding neural-activity (Vite)...\n- Refreshing PM2 process...', 
            ephemeral: true 
        });

        // Hard reset to origin/main and build
        const updateCommand = `git fetch --all && git reset --hard origin/main && npm run build-activity`;
        
        console.log(`[Restart] Initiating full update for ${pm2Name}...`);
        
        exec(updateCommand, (err, stdout, stderr) => {
            if (err) {
                console.error('[Restart] Build Failure:', err.message);
                // Clear context on failure so it doesn't loop or send wrong status
                if (fs.existsSync('./.restart_context.json')) fs.unlinkSync('./.restart_context.json');
                return interaction.followUp({ 
                    content: `❌ **Update Failed**: ${err.message}\n\`\`\`${stderr.substring(0, 300)}\`\`\``, 
                    ephemeral: true 
                });
            }
            
            const buildSuccess = stdout.includes('built in') || stdout.includes('successfully');
            const statusMsg = buildSuccess 
                ? '✅ **Neural-activity rebuilt successfully.**' 
                : '⚠️ **Rebuilt, but output was inconsistent. Proceeding...**';
            
            interaction.followUp({ 
                content: `${statusMsg}\n- Restarting \`${pm2Name}\` now...`, 
                ephemeral: true 
            }).then(() => {
                exec(`pm2 restart ${pm2Name}`, (restErr) => {
                    if (restErr) console.error('[Restart] PM2 Failure:', restErr.message);
                });
            });
        });
    }
};
