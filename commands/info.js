const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Show detailed information about the AH Music system'),
    async execute(interaction) {
        const client = interaction.client;
        const uptime = process.uptime();
        const uptimeStr = formatDuration(uptime);

        const embed = new EmbedBuilder()
            .setTitle('A H  M U S I C  //  S Y S T E M  I N F O')
            .setColor(0x2B2D31)
            .setThumbnail(client.user.displayAvatarURL())
            .setDescription('Integrated Discord Music Bot & Interactive Web Activity.')
            .addFields(
                { 
                    name: '🌐 Hᴏsᴛɪɴɢ Pʟᴀᴛғᴏʀᴍ', 
                    value: '```yaml\nProvider: Google Cloud Platform (E2-Micro)\nInstance: Ubuntu 24.04 (x86_64)\nLocation: The Dalles, Oregon (US)\nUptime: ' + uptimeStr + '```',
                    inline: false 
                },
                { 
                    name: '🛠️ Aʀᴄʜɪᴛᴇᴄᴛᴜʀᴇ', 
                    value: '```yaml\nRuntime: Node.js v22.x\nLibrary: Discord.js v14.16.3\nDashboard: https://aftrhrsmsc.duckdns.org/activity\nProxy: Caddy Reverse Proxy```',
                    inline: false 
                },
                { 
                    name: '🚀 Cᴏʀᴇ Fᴇᴀᴛᴜʀᴇs', 
                    value: '```yaml\n- 4K Search engine (yt-dlp)\n- Interactive Activity Interface\n- Real-time Lyrics Sync\n- Low-latency HLS Radio\n- Automated Queue Recovery```',
                    inline: false 
                }
            )
            .setFooter({ text: `System Version: 2.2.0-STABLE | Ping: ${client.ws.ping}ms` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
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
