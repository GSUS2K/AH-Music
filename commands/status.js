const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show bot performance and VM stats'),
    async execute(interaction) {
        await interaction.deferReply();

        // Native metrics
        const uptime = process.uptime();
        const uptimeStr = formatDuration(uptime);
        const mem = process.memoryUsage();
        const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
        const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);

        try {
            // PM2 metrics via promise
            const { stdout } = await execPromise('pm2 jlist');
            let pm2Data = null;
            if (stdout) {
                try {
                    const list = JSON.parse(stdout);
                    pm2Data = list.find(p => p.name === 'AH-Music');
                } catch (e) {
                    console.error('[Status] PM2 Parse Error:', e);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('Sʏsᴛᴇᴍ Dɪᴀɢɴᴏsᴛɪᴄs')
                .setColor(0x2B2D31)
                .setThumbnail(interaction.client.user.displayAvatarURL())
                .addFields(
                    { 
                        name: '📊 Pᴇʀғᴏʀᴍᴀɴᴄᴇ', 
                        value: `\`\`\`yaml\nRAM: ${rssMB} MB (RSS)\nHeap: ${heapMB} MB\nUptime: ${uptimeStr}\nLat: ${interaction.client.ws.ping}ms\`\`\``,
                        inline: false 
                    }
                );

            if (pm2Data) {
                const cpu = pm2Data.monit ? pm2Data.monit.cpu : 'N/A';
                const restarts = pm2Data.pm2_env ? pm2Data.pm2_env.restart_time : 'N/A';
                const status = pm2Data.pm2_env ? pm2Data.pm2_env.status : 'N/A';
                
                embed.addFields({
                    name: '🛡️ PM2 Mᴏɴɪᴛᴏʀ',
                    value: `\`\`\`yaml\nStatus: ${status.toUpperCase()}\nRestarts: ${restarts}\nCPU: ${cpu}%\nManager: PM2\`\`\``,
                    inline: false
                });
            }

            embed.addFields({
                name: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                value: `Sᴇʀᴠᴇʀs: ${interaction.client.guilds.cache.size}  |  Usᴇʀs: ${interaction.client.users.cache.size}`,
                inline: false
            });

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[Status] Command Logic Error:', err);
            await interaction.editReply({ content: 'Failed to retrieve system diagnostics.' });
        }
    }
};

function formatDuration(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}
