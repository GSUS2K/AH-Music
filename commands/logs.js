const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Show the last 20 lines of bot logs'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // Get all process info from PM2
        exec('pm2 jlist', (err, stdout) => {
            if (err || !stdout) {
                return interaction.editReply({ content: '❌ Failed to connect to PM2 manager.' });
            }

            try {
                const list = JSON.parse(stdout);
                // Find our process (case-insensitive search)
                const data = list.find(p => p.name.toLowerCase() === 'ah-music');
                
                if (!data) {
                    return interaction.editReply({ content: '❌ Could not find an active process named "AH-Music" in PM2.' });
                }

                const outLog = data.pm2_env.pm_out_log_path;
                
                // Read last 20 lines
                exec(`tail -n 20 "${outLog}"`, (tailErr, tailStdout) => {
                    const outContent = tailStdout ? tailStdout.substring(0, 1900) : 'No recent output logs found in the file.';
                    
                    const embed = new EmbedBuilder()
                        .setTitle('Bᴏᴛ Exᴇᴄᴜᴛɪᴏɴ Lᴏɢs')
                        .setColor(0x2B2D31)
                        .setDescription(`\`\`\`bash\n${outContent}\n\`\`\``)
                        .setFooter({ text: `Source: ${outLog.split('/').pop()}` });

                    interaction.editReply({ embeds: [embed] }).catch(console.error);
                });

            } catch (e) {
                console.error('[Logs] Error:', e);
                interaction.editReply({ content: '❌ Error parsing PM2 log list.' });
            }
        });
    }
};
