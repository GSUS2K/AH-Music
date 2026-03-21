require('dotenv').config();

const ffmpegBinaryPath = require('@ffmpeg-installer/ffmpeg').path;
const path = require('path');
const isWindows = process.platform === 'win32';
process.env.PATH = `${path.dirname(ffmpegBinaryPath)}${isWindows ? ';' : ':'}${process.env.PATH}`;

const fs = require('fs');
const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const { Player } = require('discord-player');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();
client.queues = new Map();

const commandsPath = path.join(__dirname, 'commands');
if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath);
}

const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Registering global slash commands...');
    const commandsData = client.commands.map(c => c.data);
    
    try {
        await client.application.commands.set(commandsData);
        console.log('Successfully registered global slash commands!');
        
        // Clear all guild commands if any exist to remove duplicates
        for (const [guildId, guild] of client.guilds.cache) {
            await guild.commands.set([]).catch(console.error);
        }
        console.log('Cleaned up legacy guild commands.');
    } catch (error) {
        console.error('Error during command registration:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            console.log(`[Command Executed] /${interaction.commandName} by ${interaction.user.tag} in ${interaction.guild?.name}`);
            await command.execute(interaction);
        } catch (error) {
            console.error(`[Command Error] Error executing /${interaction.commandName}:`, error);
            const reply = { content: 'There was an error while executing this command!', ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply).catch(console.error);
            } else {
                await interaction.reply(reply).catch(console.error);
            }
        }
    } else if (interaction.isButton()) {
        const { getVoiceConnection } = require('@discordjs/voice');
        const connection = getVoiceConnection(interaction.guild.id);
        
        if (!connection || !connection.state.subscription) {
            return interaction.reply({ content: "❌ No active audio stream to control!", ephemeral: true });
        }

        const player = connection.state.subscription.player;

        try {
            if (interaction.customId === 'pause_resume') {
                if (player.state.status === 'playing') {
                    player.pause();
                    await interaction.reply({ content: '⏸️ **Stream Paused.**', ephemeral: true });
                } else {
                    player.unpause();
                    await interaction.reply({ content: '▶️ **Stream Resumed.**', ephemeral: true });
                }
            } else if (interaction.customId === 'skip') {
                player.stop();
                await interaction.reply({ content: '⏭️ **Song Skipped!** Loading next track...', ephemeral: false });
            } else if (interaction.customId === 'download') {
                await interaction.deferReply({ ephemeral: true });
                const queue = interaction.client.queues.get(interaction.guild.id);
                if (!queue || queue.songs.length === 0) {
                    return interaction.followUp({ content: '❌ Nothing is currently playing.' });
                }

                const track = queue.songs[0];
                
                // Prevent downloading live streams or very long tracks (Discord upload limit is usually 25MB, ~25 min at 128kbps)
                if (!track.totalDurationMs || track.totalDurationMs === 0) {
                    return interaction.editReply({ content: '❌ Cannot download live radio or streams with unknown duration.' });
                }
                if (track.totalDurationMs > 25 * 60 * 1000) {
                    return interaction.editReply({ content: '❌ This track is too long to send over Discord (max 25 minutes).' });
                }

                const cleanTitle = (track.title || "audio").replace(/[^a-zA-Z0-9 -]/g, '');
                const filePath = require('path').join(__dirname, `${track.youtubeId || Date.now()}.mp3`);
                
                await interaction.editReply({ content: '⏳ Formatting track for download... please wait.' });

                try {
                    const youtubedl = require('youtube-dl-exec');
                    // Use exec with stdio ignore for stdout to prevent maxBuffer crashes and binary log splatters
                    await youtubedl.exec(track.actualUrl, {
                        x: true,
                        audioFormat: 'mp3',
                        audioQuality: 0,
                        o: filePath,
                        noCheckCertificates: true
                    }, { stdio: ['ignore', 'ignore', 'pipe'] });

                    const fs = require('fs');
                    if (!fs.existsSync(filePath)) {
                        throw new Error("File was not created by yt-dlp");
                    }
                    
                    const stats = fs.statSync(filePath);
                    if (stats.size > 25 * 1024 * 1024) {
                        return interaction.editReply({ content: "❌ The downloaded file exceeds Discord's 25MB upload limit." });
                    }

                    const { AttachmentBuilder } = require('discord.js');
                    const attachment = new AttachmentBuilder(filePath, { name: `${cleanTitle}.mp3` });

                    await interaction.editReply({ content: '✅ Here is your audio file!', files: [attachment] });
                } catch (dlError) {
                    console.error('Download error:', dlError.message || dlError);
                    await interaction.editReply({ content: '❌ Failed to extract audio or the file exceeds Discord limits.' }).catch(() => null);
                } finally {
                    const fs = require('fs');
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                }
            } else if (interaction.customId === 'stop') {
                interaction.client.queues.delete(interaction.guild.id);
                connection.destroy();
                await interaction.reply({ content: '🛑 **Stream Stopped & Queue Cleared.**', ephemeral: false });
            }
        } catch (error) {
            console.error('[Button Error]', error);
            await interaction.reply({ content: 'Failed to execute control.', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
