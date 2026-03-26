require('dotenv').config();

process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const ffmpegBinaryPath = require('@ffmpeg-installer/ffmpeg').path;
const path = require('path');
const os = require('os');
const fs = require('fs');

const ytdlpPath = path.join(__dirname, 'node_modules', '@distube', 'yt-dlp', 'bin');
process.env.PATH = `${process.env.PATH}${path.delimiter}${ytdlpPath}`;
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
client.commands = new Collection();
client.queues = new Map();

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
const staticOptions = {
    setHeaders: (res, path) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
};

app.use('/activity', express.static(distPath, staticOptions));
app.use(express.static(distPath, staticOptions));

// --- API ROUTER ---
const apiRouter = express.Router();

apiRouter.get('/health', (req, res) => res.json({ status: 'online' }));

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
    } catch (err) {
        console.error('[Auth API] Token exchange failed:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed' });
    }
});

apiRouter.get('/queue/:guildId', (req, res) => {
    const guildId = req.params.guildId;
    const queue = client.queues.get(guildId);
    if (!queue) return res.status(404).json({ songs: [], isPlaying: false, currentMs: 0 });
    const currentMs = queue.connection?.state?.subscription?.player?.state?.resource?.playbackDuration || 0;
    res.json({
        songs: queue.songs,
        isPlaying: queue.player?.state?.status === 'playing',
        voiceChannel: queue.voiceChannel?.name || 'Voice',
        lyricOffsetMs: queue.lyricOffsetMs || 0,
        currentMs: currentMs
    });
});

apiRouter.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing' });
    try {
        const youtubedl = require('youtube-dl-exec');
        const urlQuery = query.startsWith('http') ? query : `ytsearch5:${query}`;
        const options = { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, flatPlaylist: true, noCacheDir: true };
        const cookiesPath = process.env.YOUTUBE_COOKIES_PATH || './cookies.txt';
        if (require('fs').existsSync(cookiesPath)) options.cookies = cookiesPath;
        const info = await youtubedl(urlQuery, options);
        const results = (info.entries || [info]).map(entry => {
            let thumb = entry.thumbnail;
            if (!thumb && entry.thumbnails && entry.thumbnails.length > 0) {
                thumb = entry.thumbnails[entry.thumbnails.length - 1].url || entry.thumbnails[0].url;
            }
            return {
                id: entry.id, title: entry.title, 
                thumbnail: thumb || 'https://cdn.discordapp.com/embed/avatars/0.png',
                author: entry.uploader || entry.channel || 'Unknown',
                url: entry.webpage_url || entry.url, duration: (entry.duration || 0) * 1000
            };
        }).filter(r => r.id);
        res.json(results);
    } catch (err) { res.status(500).json({ error: 'Search failed' }); }
});

apiRouter.post('/add/:guildId', async (req, res) => {
    const { track, userId } = req.body;
    const guildId = req.params.guildId;
    const queueMap = client.queues;
    let queue = queueMap.get(guildId);
    if (!queue) {
        let voiceChannel;
        const guild = client.guilds.cache.get(guildId);
        if (userId && userId !== 'ActivityUser' && userId !== 'GuestUser') {
            const member = await guild?.members.fetch(userId).catch(() => null);
            voiceChannel = member?.voice.channel;
        }
        if (!voiceChannel && guild) {
            const { ChannelType } = require('discord.js');
            voiceChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildVoice && c.members.filter(m => !m.user.bot).size > 0);
        }
        if (!voiceChannel) return res.status(404).json({ error: 'Join VC.' });
        try {
            const queueConstruct = { textChannel: null, voiceChannel, connection: null, player: null, songs: [], playing: true, lastPlayedId: null, lyricOffsetMs: 0 };
            queueMap.set(guildId, queueConstruct);
            queue = queueConstruct;
            const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
            const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId, adapterCreator: guild.voiceAdapterCreator });
            await entersState(connection, VoiceConnectionStatus.Ready, 20000);
            queue.connection = connection;
        } catch (err) { return res.status(500).json({ error: 'Fail.' }); }
    }
    queue.songs.push({ ...track, actualUrl: track.url || track.actualUrl, totalDurationMs: track.duration || track.totalDurationMs, requester: userId || 'Activity', youtubeId: track.id || track.youtubeId });
    if (queue.songs.length === 1 && (!queue.player || !['playing', 'buffering'].includes(queue.player.state.status))) {
        const { playNextSong } = require('./commands/play.js');
        if (typeof playNextSong === 'function') playNextSong(guildId, queueMap, null);
    }
    res.json({ success: true, position: queue.songs.length - 1 });
});

apiRouter.post('/sync/:guildId', async (req, res) => {
    const guildId = req.params.guildId;
    const { offset } = req.body;
    const queue = client.queues.get(guildId);
    if (!queue) return res.status(404).json({ error: 'No queue' });
    queue.lyricOffsetMs = (queue.lyricOffsetMs || 0) + (offset || 0);
    res.json({ success: true, offset: queue.lyricOffsetMs });
});

apiRouter.post('/source/:guildId', async (req, res) => {
    const guildId = req.params.guildId;
    const queue = client.queues.get(guildId);
    if (!queue || !queue.songs?.[0]) return res.status(404).json({ error: 'No track' });
    const track = queue.songs[0];
    try {
        const playCmd = require('./commands/play.js');
        const results = await playCmd.fetchSyncedLyrics(track.title, track.author, (track.duration || track.totalDurationMs) / 1000, track.query, track.actualUrl, true);
        if (results && results.lyrics) {
            track.syncedLyrics = results;
            return res.json({ success: true, lyrics: results.lyrics });
        }
        res.status(404).json({ error: 'None' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

apiRouter.post('/remove/:guildId/:index', async (req, res) => {
    const { guildId, index } = req.params;
    const queue = client.queues.get(guildId);
    if (!queue) return res.status(404).json({ error: 'No queue' });
    queue.songs.splice(parseInt(index), 1);
    res.json({ success: true });
});

apiRouter.post('/control/:guildId', async (req, res) => {
    const { guildId } = req.params;
    const { action } = req.body;
    const queue = client.queues.get(guildId);
    if (!queue) return res.status(404).json({ error: 'No queue' });
    const player = queue.connection?.state?.subscription?.player;
    try {
        const playCmd = require('./commands/play.js');
        switch (action) {
            case 'pause': player?.pause(); break;
            case 'resume': player?.unpause(); break;
            case 'skip': playCmd.cleanup(guildId, client.queues); player?.stop(); break;
            case 'stop':
            case 'clear': 
                if (player) player.stop();
                playCmd.cleanup(guildId, client.queues); 
                client.queues.delete(guildId); 
                if (queue.connection) queue.connection.destroy(); 
                break;
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

apiRouter.get('/lyrics', async (req, res) => {
    const { track, artist, duration, query, url, format } = req.query;
    if (!track) return res.status(400).json({ error: 'Missing' });
    try {
        const playCmd = require('./commands/play.js');
        const results = await playCmd.fetchSyncedLyrics(track, artist, parseInt(duration || 0), query, url);
        if (format === 'json') return res.json(results && results.lyrics ? results.lyrics : []);
        res.json({ lyrics: results?.lyrics?.map(l => l.text).join('\n') || 'Not found' });
    } catch (err) { res.json({ lyrics: 'Searching...' }); }
});

apiRouter.get('/proxy', async (req, res) => {
    const url = req.query.url;
    if (!url || url.includes('discordapp.com')) return res.redirect(url || 'https://cdn.discordapp.com/embed/avatars/0.png');
    try {
        const response = await axios.get(decodeURIComponent(url), { 
            responseType: 'arraybuffer', 
            timeout: 8000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } 
        });
        res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(response.data);
    } catch (err) { 
        console.error('[Proxy Error]', err.message);
        res.redirect('https://cdn.discordapp.com/embed/avatars/0.png'); 
    }
});

apiRouter.get('/system', (req, res) => {
    const totalMem = os.totalmem();
    const usedMem = totalMem - os.freemem();
    res.json({
        mem: { total: totalMem, used: usedMem, percent: ((usedMem / totalMem) * 100).toFixed(1) },
        uptime: process.uptime(), load: os.loadavg()[0].toFixed(2), activeQueues: client.queues.size
    });
});

app.use('/api', apiRouter);
app.use('/activity/api', apiRouter);

// FINAL CATCH-ALL MIDDLEWARE (Bulletproof for Express 5)
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
});

const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        try {
            const command = require(path.join(commandsPath, file));
            if ('data' in command && 'execute' in command) client.commands.set(command.data.name, command);
        } catch (e) { console.error(`[Startup] Failed: ${file}`, e.message); }
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[BOOT] Web Server on ${PORT}`);
});

client.once('ready', async () => {
    console.log(`[BOOT] Logged in as ${client.user.tag}!`);
    const commandsData = client.commands.map(c => c.data.toJSON ? c.data.toJSON() : c.data);
    try {
        await client.application.commands.set(commandsData);
        const guilds = await client.guilds.fetch();
        for (const [id, guild] of guilds) {
            const fullGuild = await guild.fetch();
            await fullGuild.commands.set(commandsData).catch(e => console.error(`[Sync] Guild Fail: ${fullGuild.name}`, e.message));
        }
        console.log('[Sync] Neural Indexing Complete.');
    } catch (error) { console.error('[Sync] Registry Failure:', error); }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        try { await command.execute(interaction); } catch (error) { console.error(`[Exec Error] /${interaction.commandName}:`, error); }
    }
});

client.login(process.env.DISCORD_TOKEN);
