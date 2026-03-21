const { SlashCommandBuilder } = require('discord.js');
const playDl = require('play-dl');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('radio')
        .setDescription('Start a 24/7 live radio — use a URL or search by keyword (e.g. lofi, jazz, synthwave)')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('YouTube Live URL or a keyword like "lofi", "jazz radio", etc.')
                .setRequired(true)),
    async execute(interaction) {
        // Import the play logic directly
        const music = require('./play.js');
        const channel = interaction.member.voice.channel;
        
        if (!channel) return interaction.reply({ content: 'You are not connected to a voice channel!', ephemeral: true });
        
        await interaction.deferReply();
        const input = interaction.options.getString('query');

        try {
            let streamUrl = input;
            
            // If not a URL, search YouTube for a matching live stream
            if (!input.startsWith('http')) {
                const results = await playDl.search(`${input} live`, {
                    source: { youtube: 'video' },
                    limit: 3
                });
                
                // Find a result that is actually live, or take the first one
                const liveResult = results.find(r => r.live) || results[0];
                if (!liveResult) return interaction.followUp("❌ No results found for that radio station.");
                
                streamUrl = liveResult.url;
            }

            console.log(`[Radio] Delegating live stream to play engine: ${streamUrl}`);
            
            // This reuses the exact same queue and player logic that makes /play work!
            // It will also benefit from the title cleaning and lyrics search.
            return music.handlePlay(interaction, streamUrl);

        } catch (e) {
            console.error('[Radio Error]', e);
            return interaction.followUp(`❌ Failed to start radio: ${e.message}`);
        }
    }
};
