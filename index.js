require('dotenv').config();

const ffmpegBinaryPath = require('@ffmpeg-installer/ffmpeg').path;
const path = require('path');
const isWindows = process.platform === 'win32';
process.env.PATH = `${path.dirname(ffmpegBinaryPath)}${isWindows ? ';' : ':'}${process.env.PATH}`;

const fs = require('fs');

// Prefer the system-installed yt-dlp over the stale npm-bundled binary
const systemYtdlp = '/usr/local/bin/yt-dlp';
if (fs.existsSync(systemYtdlp)) {
    process.env.YOUTUBE_DL_PATH = systemYtdlp;
    console.log('[Startup] Using system yt-dlp:', systemYtdlp);
} else {
    console.log('[Startup] System yt-dlp not found, using npm bundled binary');
}

const { Client, GatewayIntentBits, Collection, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { exec } = require('child_process');
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

    // Check for restart context
    const restartFile = './.restart_context.json';
    if (fs.existsSync(restartFile)) {
        try {
            const context = JSON.parse(fs.readFileSync(restartFile, 'utf8'));
            const channel = await client.channels.fetch(context.channelId).catch(() => null);
            if (channel) {
                const message = context.updated 
                    ? '🚀 **Bot Updated!** New changes pulled and bot restarted.'
                    : '✅ **Bot Restarted.** Already up-to-date with GitHub.';
                await channel.send(message).catch(() => null);
            }
            fs.unlinkSync(restartFile);
        } catch (err) {
            console.error('[Startup] Failed to process restart context:', err.message);
        }
    }

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
            return interaction.reply({ content: "No active audio stream to control!", ephemeral: true });
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
                    return interaction.followUp({ content: 'Nothing is currently playing.' });
                }

                const track = queue.songs[0];
                
                // Prevent downloading live streams or very long tracks (Discord upload limit is usually 25MB, ~25 min at 128kbps)
                if (!track.totalDurationMs || track.totalDurationMs === 0) {
                    return interaction.editReply({ content: '❌ Cannot download live radio or streams with unknown duration.' });
                }
                if (track.totalDurationMs > 25 * 60 * 1000) {
                    return interaction.editReply({ content: '❌ This track is too long to send over Discord (max 25 minutes).' });
                }

                // Best audio is usually .webm or .m4a. Discord supports uploading and playing both natively.
                const cleanTitle = (track.title || "audio").replace(/[^a-zA-Z0-9 -]/g, '');
                
                // We don't specify extension here because yt-dlp determines it from bestaudio format
                const filePathTemplate = require('path').join(__dirname, `${track.youtubeId || Date.now()}.%(ext)s`);
                
                await interaction.editReply({ content: '⏳ Downloading highest quality audio stream... please wait.' });

                try {
                    const youtubedl = require('youtube-dl-exec');
                    // Bypass -x (ffmpeg extraction) because missing ffprobe on Ubuntu causes yt-dlp to hang forever.
                    await youtubedl.exec(track.actualUrl, {
                        f: 'bestaudio/best', // Download natively without converting to mp3
                        o: filePathTemplate,
                        noCheckCertificates: true
                    }, { stdio: ['ignore', 'ignore', 'pipe'] });

                    const fs = require('fs');
                    // Find exactly which file was created (since extension could be webm, m4a, opus)
                    const directoryFiles = fs.readdirSync(__dirname);
                    const downloadedFile = directoryFiles.find(f => f.startsWith(track.youtubeId || ''));
                    
                    if (!downloadedFile) {
                        throw new Error("Audio file was not created by yt-dlp");
                    }
                    
                    const actualFilePath = require('path').join(__dirname, downloadedFile);
                    const ext = require('path').extname(actualFilePath);
                    
                    const stats = fs.statSync(actualFilePath);
                    if (stats.size > 25 * 1024 * 1024) {
                        if (fs.existsSync(actualFilePath)) fs.unlinkSync(actualFilePath);
                        return interaction.editReply({ content: "❌ The downloaded file exceeds Discord's 25MB upload limit." });
                    }

                    const { AttachmentBuilder } = require('discord.js');
                    const attachment = new AttachmentBuilder(actualFilePath, { name: `${cleanTitle}${ext}` });

                    await interaction.editReply({ content: '✅ Here is your audio file!', files: [attachment] });
                    // Clean up after sending
                    setTimeout(() => { if (fs.existsSync(actualFilePath)) fs.unlinkSync(actualFilePath); }, 5000);

                } catch (dlError) {
                    console.error('Download error:', dlError.message || dlError);
                    await interaction.editReply({ content: '❌ Failed to extract audio or the file exceeds Discord limits.' }).catch(() => null);
                }
            } else if (interaction.customId === 'sync_minus' || interaction.customId === 'sync_plus') {
                const queue = interaction.client.queues.get(interaction.guild.id);
                if (!queue) return interaction.reply({ content: 'No active queue found.', ephemeral: true });
                
                const adjustment = interaction.customId === 'sync_minus' ? -1000 : 1000;
                queue.lyricOffsetMs = (queue.lyricOffsetMs || 0) + adjustment;
                
                const offsetSec = (queue.lyricOffsetMs / 1000).toFixed(1);
                await interaction.reply({ 
                    content: `Lyric sync adjusted to **${offsetSec > 0 ? '+' : ''}${offsetSec}s**. The next lyric update will reflect this change.`, 
                    ephemeral: true 
                });
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
