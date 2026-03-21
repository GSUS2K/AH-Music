const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const player = new Player(client);

async function main() {
    await player.extractors.loadMulti(DefaultExtractors);
    const results = await player.search('https://soundcloud.com/futureisnow/mask-off');
    console.log(`Found: ${results.tracks[0]?.title}`);
    const track = results.tracks[0];
    try {
        const stream = await player.extractors.run(async (ext) => {
            if (ext.createStream) return await ext.createStream(track);
            return null;
        });
        // or just track.extractor.createStream(track)
        const s = await track.extractor.createStream(track);
        console.log("Stream successfully created:", s ? "Yes" : "No");
    } catch (e) {
        console.error("Error creating stream:", e);
    }
    process.exit(0);
}
main();
