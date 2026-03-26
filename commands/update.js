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
        
        const context = {
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            updated: true,
            timestamp: Date.now()
        };
        fs.writeFileSync('./.restart_context.json', JSON.stringify(context));

        await interaction.reply({ 
            content: '🚀 **Dedicated Neural-Update Sequence Initiated**\n- Pulling latest source...\n- Rebuilding Vite production bundle...\n- Refreshing PM2 process...', 
            ephemeral: true 
        });

        const updateCommand = `git fetch --all && git reset --hard origin/main && npm run build-activity`;
        
        exec(updateCommand, (err, stdout, stderr) => {
            if (err) {
                console.error('[Update] Error:', err.message);
                if (fs.existsSync('./.restart_context.json')) fs.unlinkSync('./.restart_context.json');
                return interaction.followUp({ content: `❌ **Update Failed**: ${err.message}`, ephemeral: true });
            }
            
            interaction.followUp({ content: '✅ **Rebuild successful.** Restarting instance now...', ephemeral: true }).then(() => {
                exec(`pm2 restart ${pm2Name}`);
            });
        });
    }
};
