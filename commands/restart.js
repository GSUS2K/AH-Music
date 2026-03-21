const { SlashCommandBuilder } = require('discord.js');
const { exec } = require('child_process');

const OWNER_ID = '682288992456409096';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Restart the bot (Owner only)'),
    async execute(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
        }

        await interaction.reply({ content: 'Pulling latest code and restarting bot...', ephemeral: true });
        
        exec('git pull && pm2 restart AH-Music', (err, stdout, stderr) => {
            if (err) {
                console.error('[Restart] Error:', err.message);
                console.error('[Restart] Stderr:', stderr);
                return;
            }
            console.log('[Restart] Success:', stdout);
        });
    }
};
