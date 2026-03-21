const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Show the last 20 lines of bot logs'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // Get log paths from PM2 dynamically
        exec('pm2 show AH-Music --json', (err, stdout) => {
            if (err || !stdout) {
                return interaction.editReply({ content: '❌ Failed to retrieve log paths from PM2.' });
            }

            try {
                const data = JSON.parse(stdout);
                const outLog = data[0].pm2_env.pm_out_log_path;
                const errLog = data[0].pm2_env.pm_err_log_path;

                // Read last 20 lines from outLog
                exec(`tail -n 20 "${outLog}"`, (tailErr, tailStdout) => {
                    const outContent = tailStdout ? tailStdout.substring(0, 1900) : 'No recent output logs.';
                    
                    const embed = new EmbedBuilder()
                        .setTitle('Bᴏᴛ Exᴇᴄᴜᴛɪᴏɴ Lᴏɢs')
                        .setColor(0x2B2D31)
                        .setDescription(`\`\`\`bash\n${outContent}\n\`\`\``)
                        .setFooter({ text: 'Showing last 20 lines of AH-Music-out.log' });

                    interaction.editReply({ embeds: [embed] }).catch(console.error);
                });

            } catch (e) {
                console.error('[Logs] Error:', e);
                interaction.editReply({ content: '❌ Error parsing PM2 log data.' });
            }
        });
    }
};
