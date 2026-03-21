const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current music queue'),
    async execute(interaction) {
        const queue = useQueue(interaction.guild.id);
        if (!queue || !queue.tracks.data.length) {
            return interaction.reply({ content: 'The queue is currently empty!', ephemeral: true });
        }
        
        const currentTrack = queue.currentTrack;
        const tracks = queue.tracks.data.slice(0, 10).map((t, i) => `${i + 1}. **${t.title}** - \`${t.duration}\``);
        
        let message = `**Now Playing:** ${currentTrack.title}\n\n**Up Next:**\n${tracks.join('\n')}`;
        if (queue.tracks.data.length > 10) {
            message += `\n*...and ${queue.tracks.data.length - 10} more*`;
        }

        return interaction.reply(message);
    }
};
