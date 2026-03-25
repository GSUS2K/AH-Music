require('dotenv').config();

const ffmpegBinaryPath = require('@ffmpeg-installer/ffmpeg').path;
const path = require('path');
const os = require('os');
const fs = require('fs');

// Inject yt-dlp binary into PATH for all child processes
const ytdlpPath = path.join(__dirname, 'node_modules', '@distube', 'yt-dlp', 'bin');
process.env.PATH = `${process.env.PATH}${process.platform === 'win32' ? ';' : ':'}${ytdlpPath}`;
console.log(`[Startup] Injected yt-dlp to PATH: ${ytdlpPath}`);

const isWindows = process.platform === 'win32';
process.env.PATH = `${path.dirname(ffmpegBinaryPath)}${isWindows ? ';' : ':'}${process.env.PATH}`;

// Prefer the system-installed yt-dlp or the local @distube binary
const systemYtdlp = process.env.SYSTEM_YTDLP_PATH || '/usr/local/bin/yt-dlp';
const localYtdlp = path.join(__dirname, 'node_modules', '@distube', 'yt-dlp', 'bin', 'yt-dlp');

if (fs.existsSync(systemYtdlp)) {
    process.env.YOUTUBE_DL_PATH = systemYtdlp;
    console.log('[Startup] Using system yt-dlp:', systemYtdlp);
} else if (fs.existsSync(localYtdlp)) {
    process.env.YOUTUBE_DL_PATH = localYtdlp;
    console.log('[Startup] Using local @distube yt-dlp:', localYtdlp);
} else {
    console.log('[Startup] Using npm bundled fallback');
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

const express = require('express');
const cors = require('cors');
const compression = require('compression');

const app = express();
app.use(compression());
const axios = require('axios');
app.use(cors());
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// --- AGGRESSIVE FRONTEND SERVING ---
const distPath = path.join(__dirname, 'frontend', 'dist');
console.log('[Startup] Mapping static assets to:', distPath);
// Serve static assets at both the root and the /activity subpath to support all URL variations
app.use('/activity', express.static(distPath));
app.use(express.static(distPath));

// Debug: Log all API requests to see if frontend is talking to backend
app.use('/api', (req, res, next) => {
    console.log(`[API Request] ${req.method} ${req.url}`);
    next();
});

// --- API ROUTER FOR ALL ACTIVITY ENDPOINTS ---
const apiRouter = express.Router();

apiRouter.post('/token', async (req, res) => {
    const { code } = req.body;
    try {
        const response = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.VITE_DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        res.json({ access_token: response.data.access_token });
        console.log('[Auth API] Token exchange successful for User');
    } catch (err) {
        console.error('[Auth API] Token exchange failed:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to exchange token' });
    }
});

apiRouter.post('/log', (req, res) => {
    const { message, error } = req.body;
    console.warn(`[Frontend Debug] ${message}`, error || '');
    res.json({ status: 'ok' });
});

apiRouter.get('/health', (req, res) => res.json({ status: 'online' }));

apiRouter.get('/queue/:guildId', (req, res) => {
    const guildId = req.params.guildId;
    const queue = client.queues.get(guildId);
    if (!queue) return res.status(404).json({ songs: [], isPlaying: false });
    res.json({
        songs: queue.songs,
        isPlaying: queue.player?.state?.status === 'playing',
        voiceChannel: queue.voiceChannel?.name || 'Voice',
        lyricOffsetMs: queue.lyricOffsetMs || 0
    });
});

// MOUNT ROUTER TWICE
app.use('/api', apiRouter);
app.use('/activity/api', apiRouter);
apiRouter.get('/lyrics', async (req, res) => {
    const { track, artist, duration, query, url, format } = req.query;
    if (!track) return res.status(400).json({ error: 'Missing track' });
    try {
        const playCmd = require('./commands/play.js');
        const results = await playCmd.fetchSyncedLyrics(track, artist, parseInt(duration || 0), query, url);
        if (format === 'json') return res.json(results && results.lyrics ? results.lyrics : []);
        res.json({ lyrics: results?.lyrics?.map(l => `[${Math.floor(l.time/60000)}:${Math.floor((l.time%60000)/1000).toString().padStart(2,'0')}] ${l.text}`).join('\n') || 'Lyrics not found' });
    } catch (err) { res.json({ lyrics: 'Searching...' }); }
});

apiRouter.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing query' });
    try {
        const youtubedl = require('youtube-dl-exec');
        const urlQuery = query.startsWith('http') ? query : `ytsearch5:${query}`;
        const info = await youtubedl(urlQuery, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, flatPlaylist: true });
        const results = (info.entries || [info]).map(entry => ({
            id: entry.id, title: entry.title, thumbnail: entry.thumbnail,
            author: entry.uploader || entry.channel || 'Unknown',
            url: entry.webpage_url || entry.url, duration: (entry.duration || 0) * 1000
        })).filter(r => r.id);
        res.json(results);
    } catch (err) { res.status(500).json({ error: 'Search failed' }); }
});

app.get('/api/queue/:guildId', (req, res) => {
    const guildId = req.params.guildId;
    const queue = client.queues.get(guildId);
    
    if (!queue) {
        // Reduced logging to avoid spamming the console
        return res.status(404).json({ error: 'No active queue' });
    }

    res.json({
        isPlaying: queue.player ? queue.player.state.status === 'playing' : false,
        voiceChannel: queue.voiceChannel ? queue.voiceChannel.name : 'Unknown',
        currentMs: queue.player ? (queue.songs[0]?.resource?.playbackDuration || 0) : 0,
        lyricOffsetMs: queue.lyricOffsetMs || 0,
        songs: queue.songs.map(s => ({
            title: s.title,
            author: s.author,
            thumbnail: s.thumbnail,
            duration: s.totalDurationMs,
            syncedLyrics: s.syncedLyrics,
        }))
    });

    // Reset idle timer whenever queue is accessed via Activity
    if (queue.idleTimer) clearTimeout(queue.idleTimer);
    queue.idleTimer = setTimeout(() => {
        console.log(`[Resources] Guild ${guildId} idle for 10m. Purging resources...`);
        const { cleanup } = require('./commands/play.js');
        cleanup(guildId, client.queues);
        if (queue.connection) queue.connection.destroy();
        client.queues.delete(guildId);
    }, 10 * 60 * 1000); 
});

app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        const youtubedl = require('youtube-dl-exec');
        const info = await youtubedl(`ytsearch5:${query}`, {
            dumpSingleJson: true, 
            noCheckCertificates: true, 
            noWarnings: true
        });

        const results = (info.entries || []).map(entry => ({
            title: entry.title,
            author: entry.uploader,
            thumbnail: entry.thumbnail,
            url: entry.webpage_url,
            duration: (entry.duration || 0) * 1000,
            id: entry.id
        }));

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sync/:guildId', (req, res) => {
    const { guildId } = req.params;
    const { offset } = req.body;
    const queue = client.queues.get(guildId);
    if (!queue) return res.status(404).json({ error: 'No active queue' });
    
    queue.lyricOffsetMs = (queue.lyricOffsetMs || 0) + (parseInt(offset) || 0);
    console.log(`[Lyrics] Manual sync adjusted for ${guildId}: ${queue.lyricOffsetMs}ms`);
    res.json({ success: true, newOffset: queue.lyricOffsetMs });
});

app.post('/api/source/:guildId', async (req, res) => {
    const { guildId } = req.params;
    const queue = client.queues.get(guildId);
    if (!queue || !queue.songs[0]) return res.status(404).json({ error: 'No active track' });
    
    console.log(`[Lyrics] Changing source for ${guildId}: ${queue.songs[0].title}`);
    const play = require('./commands/play.js');
    const lyricsData = await play.fetchSyncedLyrics(queue.songs[0].title, queue.songs[0].author, queue.songs[0].totalDurationMs / 1000, null, queue.songs[0].actualUrl, true);
    if (lyricsData) {
        queue.songs[0].syncedLyrics = lyricsData;
        res.json({ success: true, lyrics: lyricsData.lyrics });
    } else {
        res.status(404).json({ error: 'No alternative lyrics found' });
    }
});

app.get('/api/system', (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const botMem = process.memoryUsage().rss;
    
    res.json({
        mem: {
            total: totalMem,
            free: freeMem,
            used: usedMem,
            percent: ((usedMem / totalMem) * 100).toFixed(1),
            bot: botMem
        },
        uptime: process.uptime(),
        load: os.loadavg()[0].toFixed(2),
        platform: os.platform(),
        activeQueues: client.queues.size
    });
});

app.get('/api/proxy', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing URL');
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        res.set('Content-Type', response.headers['content-type']);
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(response.data);
    } catch (err) {
        res.status(500).send('Proxy failed');
    }
});

app.get('/api/lyrics', async (req, res) => {
    const { track, artist, duration, query, url, format } = req.query;
    if (!track) return res.status(400).json({ error: 'Missing track' });
    
    try {
        const playCmd = require('./commands/play.js');
        const results = await playCmd.fetchSyncedLyrics(track, artist, parseInt(duration || 0), query, url);
        
        if (format === 'json') {
            return res.json(results && results.lyrics ? results.lyrics : []);
        }

        if (results && results.lyrics) {
            res.json({ lyrics: results.lyrics.map(l => `[${Math.floor(l.time/60000)}:${Math.floor((l.time%60000)/1000).toString().padStart(2,'0')}] ${l.text}`).join('\n') });
        } else {
            res.json({ lyrics: 'Lyrics not found for this track in the global database.' });
        }
    } catch (err) {
        res.json({ lyrics: 'Searching for synchronized signal...' });
    }
});

app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing query' });
    
    try {
        const youtubedl = require('youtube-dl-exec');
        const urlQuery = query.startsWith('http') ? query : `ytsearch5:${query}`;
        const options = { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, flatPlaylist: true };
        
        const cookiesPath = process.env.YOUTUBE_COOKIES_PATH || './cookies.txt';
        if (require('fs').existsSync(cookiesPath)) options.cookies = cookiesPath;

        const info = await youtubedl(urlQuery, options);
        const results = (info.entries || [info]).map(entry => ({
            id: entry.id,
            title: entry.title,
            thumbnail: entry.thumbnail,
            author: entry.uploader || entry.channel || 'Unknown',
            url: entry.webpage_url || entry.url,
            duration: (entry.duration || 0) * 1000
        })).filter(r => r.id);

        res.json(results);
    } catch (err) {
        console.error('[API Search] Failed:', err.message);
        res.status(500).json({ error: 'Search failed' });
    }
});

app.all('/api/interactions', async (req, res) => {
    if (req.method === 'GET') {
        return res.status(200).send('Interactions Endpoint is ACTIVE. This URL is for Discord POST requests only. Please use it in the Developer Portal.');
    }

    const signature = req.get('X-Signature-Ed25519');
    const timestamp = req.get('X-Signature-Timestamp');
    const body = req.rawBody;

    if (!signature || !timestamp || !body) {
        return res.status(401).end('Missing signature headers');
    }

    const nacl = require('tweetnacl');
    const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
    
    if (!PUBLIC_KEY) {
        // Fallback for verification if not yet in .env (only for PING during setup)
        if (req.body.type === 1) return res.json({ type: 1 });
        return res.status(500).end('Public Key missing in server environment');
    }

    const isVerified = nacl.sign.detached.verify(
        Buffer.concat([Buffer.from(timestamp), body]),
        Buffer.from(signature, 'hex'),
        Buffer.from(PUBLIC_KEY, 'hex')
    );

    if (!isVerified) {
        return res.status(401).end('Invalid signature');
    }

    // Handle Discord PING
    if (req.body.type === 1) {
        return res.json({ type: 1 });
    }

    // Since we use the Gateway for actual commands, we just 200 other types
    res.status(200).end();
});
app.get('/api/queue/:guildId', (req, res) => {
    const guildId = req.params.guildId;
    const queue = client.queues.get(guildId);
    if (!queue) return res.status(404).json({ songs: [], isPlaying: false });
    
    res.json({
        songs: queue.songs,
        isPlaying: queue.player?.state?.status === 'playing',
        voiceChannel: queue.voiceChannel?.name || 'Voice',
        lyricOffsetMs: queue.lyricOffsetMs || 0
    });
});

app.post('/api/add/:guildId', async (req, res) => {
    const { track, userId } = req.body;
    const guildId = req.params.guildId;
    const queueMap = client.queues;
    let queue = queueMap.get(guildId);

    console.log(`[Activity API] Add Attempt - Guild: ${guildId}, User: ${userId}, Track: "${track?.title}"`);

    if (!queue) {
        let voiceChannel;
        const guild = client.guilds.cache.get(guildId);
        
        if (userId && userId !== 'ActivityUser') {
            const member = await guild?.members.fetch(userId).catch(() => null);
            voiceChannel = member?.voice.channel;
        }

        // FALLBACK: If userId is generic or member not found, find ANY VC with active members
        if (!voiceChannel && guild) {
            const { ChannelType } = require('discord.js');
            voiceChannel = guild.channels.cache.find(c => 
                c.type === ChannelType.GuildVoice && 
                c.members.filter(m => !m.user.bot).size > 0
            );
            if (voiceChannel) {
                console.log(`[Activity API] Anonymous Wake triggered. Using VC: ${voiceChannel.name}`);
            }
        }

        if (!voiceChannel) {
            return res.status(404).json({ error: 'Please join a Voice Channel first so the bot can follow you.' });
        }

        try {
            // Create new queue construct
            const queueConstruct = {
                textChannel: null, // We don't have a command interaction channel here
                voiceChannel: voiceChannel,
                connection: null,
                player: null,
                songs: [],
                playing: true,
                lastPlayedId: null,
                lyricOffsetMs: 0
            };
            queueMap.set(guildId, queueConstruct);
            queue = queueConstruct;

            const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guildId,
                adapterCreator: guild.voiceAdapterCreator
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
            queue.connection = connection;
        } catch (err) {
            console.error('[Activity API] Auto-join failed:', err);
            return res.status(500).json({ error: 'Failed to join Voice Channel.' });
        }
    }

    queue.songs.push({
        ...track,
        actualUrl: track.url || track.actualUrl,
        totalDurationMs: track.duration || track.totalDurationMs,
        requester: userId || 'Activity',
        youtubeId: track.id || track.youtubeId
    });

    if (queue.songs.length === 1) {
        // Only trigger play if the player is not already handling something
        const isActuallyPlaying = queue.player && ['playing', 'buffering'].includes(queue.player.state.status);
        if (!isActuallyPlaying) {
            const { playNextSong } = require('./commands/play.js'); 
            if (typeof playNextSong === 'function') {
                playNextSong(guildId, queueMap, null);
            }
        }
    }

    res.json({ success: true, position: queue.songs.length - 1 });
});

app.post('/api/control/:guildId', async (req, res) => {
    const { action } = req.body;
    const guildId = req.params.guildId;
    const { getVoiceConnection } = require('@discordjs/voice');
    const connection = getVoiceConnection(guildId);

    if (!connection || !connection.state.subscription) {
        return res.status(404).json({ error: 'No active stream' });
    }

    const player = connection.state.subscription.player;

    try {
        switch (action) {
            case 'pause':
                player.pause();
                break;
            case 'resume':
                player.unpause();
                break;
            case 'skip':
                const { cleanup } = require('./commands/play.js');
                cleanup(guildId, client.queues);
                player.stop();
                break;
            case 'stop':
            case 'clear':
                const playCmd = require('./commands/play.js');
                playCmd.cleanup(guildId, client.queues);
                client.queues.delete(guildId);
                connection.destroy();
                break;
            case 'sync_plus':
                if (queue) queue.lyricOffsetMs = (queue.lyricOffsetMs || 0) + 1000;
                break;
            case 'sync_minus':
                if (queue) queue.lyricOffsetMs = (queue.lyricOffsetMs || 0) - 1000;
                break;
            case 'download':
                // Track is already in queue[0]. We don't need to do anything here 
                // as the /api/interactions logic handles the actual attachment 
                // if triggered via Discord button, but for Activity we might 
                // just return the URL for the frontend to handle.
                break;
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
        res.json({ success: true, action, offset: queue?.lyricOffsetMs || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Final catch-all for SPA routing (using middleware to avoid path-to-regexp errors)
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
});

const commandsPath = path.join(__dirname, 'commands');
if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath);
}

const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

// Start Express Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Activity] Web Server running on port ${PORT}`);
});

client.once('ready', async () => {
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
    } catch (error) {
        if (error.code === 50240) {
            console.warn('[Warning] Global registration restricted. Falling back to Guild-level propagation...');
            for (const [guildId, guild] of client.guilds.cache) {
                await guild.commands.set(commandsData).catch(err => {
                    console.error(`[Fatal] Failed to register to guild ${guildId}:`, err.message);
                });
            }
            console.log('Guild-level command propagation completed.');
        } else {
            console.error('Error during command registration:', error);
        }
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
                const uploadLimitMb = parseInt(process.env.DISCORD_UPLOAD_LIMIT_MB) || 25;
                if (track.totalDurationMs > uploadLimitMb * 60 * 1000) {
                    return interaction.editReply({ content: `❌ This track is too long to send over Discord (max ${uploadLimitMb} minutes).` });
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
                    
                    const uploadLimitMb = parseInt(process.env.DISCORD_UPLOAD_LIMIT_MB) || 25;
                    const stats = fs.statSync(actualFilePath);
                    if (stats.size > uploadLimitMb * 1024 * 1024) {
                        if (fs.existsSync(actualFilePath)) fs.unlinkSync(actualFilePath);
                        return interaction.editReply({ content: `❌ The downloaded file exceeds Discord's ${uploadLimitMb}MB upload limit.` });
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
                
                const syncStepMs = parseInt(process.env.LYRIC_SYNC_STEP_MS) || 1000;
                const adjustment = interaction.customId === 'sync_minus' ? -syncStepMs : syncStepMs;
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
