const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows all available commands for the bot'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🤖 Bot Commands')
            .setDescription('Here are all the commands you can use with this music bot:')
            .addFields(
                { name: '🎶 `/play [query]`', value: 'Play a song instantly. Best for specific songs/artists (uses SoundCloud).' },
                { name: '📻 `/radio [url]`', value: 'Play a continuous 24/7 stream. Requires a YouTube Livestream URL.' },
                { name: '⏸️ `/pause`', value: 'Pause the currently playing audio.' },
                { name: '▶️ `/resume`', value: 'Resume the paused audio.' },
                { name: '⏭️ `/skip`', value: 'Skip or stop the current stream.' },
                { name: '🛑 `/stop`', value: 'Stop the music entirely and leave the voice channel.' },
                { name: '📊 `/info`', value: 'Show detailed system telemetry and bot status.' },
                { name: '❓ `/help`', value: 'Show this help universally.' }
            )
            .setColor(0x8A2BE2)
            .setFooter({ text: 'Running exclusively on Edge Process' });
            
        return interaction.reply({ embeds: [embed] });
    }
};
