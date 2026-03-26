const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, VoiceConnectionStatus, AudioPlayerStatus } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs');

const https = require('https');
const http = require('http');
const { PassThrough } = require('stream');
const { version } = require('../version.json');

module.exports = {
    fetchSyncedLyrics: fetchSyncedLyrics,
    playNextSong: null, // Initialized below
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from any source')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The song URL or search query')
                .setRequired(true)),
    execute(interaction) {
        const query = interaction.options.getString('query');
        return module.exports.handlePlay(interaction, query);
    },
    async handlePlay(interaction, query) {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply({ content: 'You are not connected to a voice channel!', flags: [MessageFlags.Ephemeral] });
        
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();

        try {
            let title, thumbnail, author, actualUrl, totalDurationMs, youtubeId, introOffsetMs = 0;
            const startWords = (process.env.MUSIC_START_WORDS || "music,song,start,feeka,sukoon,play").split(',').join('|');
            const MUSIC_CHAPTER_REGEX = new RegExp(startWords, 'i');

            // Use yt-dlp for search and metadata
             try {
                const urlQuery = query.startsWith('http') ? query : `ytsearch1:${query}`;
                const options = { 
                    dumpSingleJson: true, noCheckCertificates: true, noWarnings: true
                };
                
                const cookiesPath = process.env.YOUTUBE_COOKIES_PATH || './cookies.txt';
                if (fs.existsSync(cookiesPath)) {
                    options.cookies = cookiesPath;
                    console.log('[Play] Using cookies for search:', cookiesPath);
                }
                options.extractorArgs = 'youtube:player_client=android_vr';

                const info = await youtubedl(urlQuery, options);
                const entry = info.entries ? info.entries[0] : info;
                if (!entry) throw new Error('No results');
                title = entry.title || 'Unknown Track';
                thumbnail = entry.thumbnail || (entry.thumbnails && entry.thumbnails.length > 0 ? entry.thumbnails[0].url : 'https://cdn.discordapp.com/embed/avatars/0.png');
                author = entry.uploader || 'Unknown Artist';
                actualUrl = entry.webpage_url || query;
                totalDurationMs = (entry.is_live || entry.live_status === 'is_live') ? 0 : (entry.duration || 0) * 1000;
                youtubeId = entry.id;

                // Check for chapters to find intro offset
                if (entry.chapters && entry.chapters.length > 0) {
                    const musicChapter = entry.chapters.find(c => /music|song|start/i.test(c.title));
                    if (musicChapter && musicChapter.start_time > 0) {
                        introOffsetMs = musicChapter.start_time * 1000;
                        console.log(`[Lyrics] Detected music start offset at: ${introOffsetMs}ms (${musicChapter.title})`);
                    }
                }
            } catch (searchErr) {
                console.error('[Play] yt-dlp search failed:', searchErr.message);
                if (searchErr.stderr) console.error('[Play] Detail:', searchErr.stderr);
                return interaction.editReply({ content: "❌ Request failed - could not find the song or it may be private." });
            }

            const track = { title, thumbnail, author, actualUrl, totalDurationMs, query, requester: interaction.user.id, youtubeId, introOffsetMs };

            const queueMap = interaction.client.queues;
            let serverQueue = queueMap.get(interaction.guild.id);

            // If a queue exists but the connection is destroyed, clear it and start fresh
            if (serverQueue) {
                const connState = serverQueue.connection?.state?.status;
                const isAlive = connState && connState !== VoiceConnectionStatus.Destroyed;
                if (!isAlive) {
                    console.log('[Queue] Stale queue detected, clearing and restarting...');
                    queueMap.delete(interaction.guild.id);
                    serverQueue = null;
                }
            }

            if (serverQueue) {
                serverQueue.songs.push(track);
                const addEmbed = new EmbedBuilder()
                    .setTitle('Added to Queue')
                    .setDescription(`**[${track.title}](${track.actualUrl})**\nPosition in queue: **${serverQueue.songs.length - 1}**`)
                    .setThumbnail(track.thumbnail)
                    .setColor(0x0099FF);
                return interaction.editReply({ embeds: [addEmbed] });
            }

            const queueConstruct = {
                textChannel: interaction.channel,
                voiceChannel: channel,
                connection: null,
                player: null,
                songs: [track],
                playing: true,
                lastPlayedId: null,
                lyricOffsetMs: 0
            };
            queueMap.set(interaction.guild.id, queueConstruct);

            try {
                const connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: interaction.guild.id,
                    adapterCreator: interaction.guild.voiceAdapterCreator
                });
                await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
                queueConstruct.connection = connection;

                await module.exports.playNextSong(interaction.guild.id, queueMap, interaction);

            } catch (err) {
                console.error(err);
                if (interaction.guild?.id) queueMap.delete(interaction.guild.id);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: "Could not join the voice channel.", flags: [MessageFlags.Ephemeral] }).catch(() => null);
                } else {
                    await interaction.followUp({ content: "Could not join the voice channel.", flags: [MessageFlags.Ephemeral] }).catch(() => null);
                }
            }

        } catch (e) {
            console.error(e);
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(`Something went wrong: ${e.message}`).catch(() => null);
            } else {
                await interaction.reply(`Something went wrong: ${e.message}`).catch(() => null);
            }
        }
    },
    async playNextSong(guildId, queueMap, interaction) {
        const queue = queueMap.get(guildId);
        if (queue && queue.songs?.[0]) {
            console.log(`[Queue] Starting: "${queue.songs[0].title}" (${queue.songs[0].actualUrl})`);
            queue.lyricOffsetMs = 0;
        }
        
        if (queue && queue.songs.length === 0 && queue.lastPlayedId) {
            try {
                if (queue.textChannel) {
                    await queue.textChannel.send({ content: "Generating the next Up-Next Autoplay track natively..." }).catch(() => null);
                }
                const mixUrl = `https://www.youtube.com/watch?v=${queue.lastPlayedId}&list=RD${queue.lastPlayedId}`;
                const options = { 
                    dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, 
                    playlistItems: '2', extractAudio: true
                };

                const cookiesPath = process.env.YOUTUBE_COOKIES_PATH || './cookies.txt';
                if (fs.existsSync(cookiesPath)) {
                    options.cookies = cookiesPath;
                }

                const info = await youtubedl(mixUrl, options).catch(() => null);
                
                const entry = info && info.entries ? info.entries[0] : null;
                if (entry && entry.id) {
                    queue.songs.push({
                        title: entry.title || "Autoplay Track",
                        thumbnail: entry.thumbnail || 'https://cdn.discordapp.com/embed/avatars/0.png',
                        author: entry.uploader || "YouTube Autoplay",
                        actualUrl: entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}`,
                        totalDurationMs: (entry.duration || 0) * 1000,
                        query: mixUrl,
                        requester: 'Autoplay',
                        youtubeId: entry.id
                    });
                }
            } catch (err) {
                console.error("Autoplay generation failed:", err);
            }
        }

        if (!queue || queue.songs.length === 0) {
            if (queue && queue.connection) queue.connection.destroy();
            if (queue && queue.currentProcess) {
                queue.currentProcess.kill('SIGKILL');
                queue.currentProcess = null;
            }
            if (queue && queue.progressInterval) clearInterval(queue.progressInterval);
            queueMap.delete(guildId);
            return;
        }

        // --- NEW: Force cleanup of any old stale process before starting next ---
        if (queue.currentProcess) {
            queue.currentProcess.kill('SIGKILL');
            queue.currentProcess = null;
        }

        const track = queue.songs[0];
        if (!track) return;
        queue.lastPlayedId = track.youtubeId;

        // Reuse player if it exists and is attached
        if (!queue.player) {
            queue.player = createAudioPlayer({
                behaviors: { noSubscriber: 'pause' },
            });
            queue.connection.subscribe(queue.player);

            queue.player.on(AudioPlayerStatus.Idle, () => {
                console.log(`[Queue] Track ended/skipped in Guild: ${guildId}. Next up...`);
                if (queue.progressInterval) clearInterval(queue.progressInterval);
                queue.lyricOffsetMs = 0;
                queue.songs.shift(); 
                module.exports.playNextSong(guildId, queueMap, null);
            });

            queue.player.on('error', error => {
                console.error(`[Player Error] ${error.message} - skipping track...`);
                queue.player.stop(); 
            });

            queue.player.on('stateChange', (oldState, newState) => {
                if (newState.status !== oldState.status) {
                    console.log(`[Player Status] ${oldState.status} -> ${newState.status}`);
                }
            });
        }

        const player = queue.player;

        const isLive = track.totalDurationMs === 0;
        let resource;

        // Stream directly via yt-dlp (uses system ffmpeg)
        try {
            if (isLive) {
                // Get the direct m3u8 playlist URL from yt-dlp (no ffmpeg needed for this)
                const options = {
                    getUrl: true,
                    f: 'best[protocol=m3u8_native]/best',
                    noCheckCertificates: true
                };

                const cookiesPath = process.env.YOUTUBE_COOKIES_PATH || './cookies.txt';
                if (fs.existsSync(cookiesPath)) {
                    options.cookies = cookiesPath;
                }

                const m3u8Url = await youtubedl(track.actualUrl, options).catch(() => null);

                if (m3u8Url) {
                    const getUrl = (url) => new Promise((resolve, reject) => {
                        const client = url.startsWith('https') ? https : http;
                        const req = client.get(url, (res) => {
                            const chunks = [];
                            res.on('data', c => chunks.push(c));
                            res.on('end', () => resolve(Buffer.concat(chunks)));
                            res.on('error', reject);
                        });
                        req.on('error', reject);
                        req.setTimeout(10000, () => {
                            req.destroy();
                            reject(new Error('Request timeout'));
                        });
                    });

                    const pass = new PassThrough();
                    let lastSegs = [];
                    let stopped = false;

                    const pollHLS = async () => {
                        while (!stopped) {
                            try {
                                const buf = await getUrl(m3u8Url.trim());
                                const text = buf.toString();
                                const base = m3u8Url.trim().split('/').slice(0, -1).join('/');
                                const segs = text.split('\n')
                                    .map(l => l.trim())
                                    .filter(l => l && !l.startsWith('#'));

                                for (const seg of segs) {
                                    if (stopped) break;
                                    const segUrl = seg.startsWith('http') ? seg : `${base}/${seg}`;
                                    if (!lastSegs.includes(segUrl)) {
                                        lastSegs.push(segUrl);
                                        if (lastSegs.length > 20) lastSegs.shift(); // Keep cache small
                                        
                                        try {
                                            const data = await getUrl(segUrl);
                                            if (!stopped && !pass.destroyed && pass.writable) {
                                                pass.write(data);
                                            }
                                        } catch (e) {
                                            console.error('[HLS] Segment error:', e.message);
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error('[HLS] Playlist error:', e.message);
                            }
                            // Dynamic wait: if we found new segments, wait less. otherwise wait 2s.
                            const pollInterval = parseInt(process.env.HLS_POLL_INTERVAL_MS) || 2000;
                            await new Promise(r => setTimeout(r, pollInterval));
                        }
                    };

                    pollHLS();
                    const cleanup = () => { stopped = true; lastSegs = []; };
                    pass.on('close', cleanup);
                    pass.on('end', cleanup);
                    pass.on('error', cleanup);

                    resource = createAudioResource(pass);
                    console.log('[Stream] Live: HLS segment streamer started (no ffmpeg)');
                } else {
                    console.error('[Stream] Failed to get live stream URL');
                }
            } else {
                const { spawn } = require('child_process');
                const ytdlpPath = process.env.YOUTUBE_DL_PATH || 'yt-dlp';
                
                const proc = spawn(ytdlpPath, [
                    track.actualUrl,
                    '--output', '-',
                    '--format', 'bestaudio[ext=webm]/bestaudio/best',
                    '--no-check-certificates',
                    '--no-warnings',
                    '--quiet',
                    '--force-ipv4',
                    '--cookies', process.env.YOUTUBE_COOKIES_PATH || './cookies.txt',
                    '--extractor-args', 'youtube:player_client=android_vr',
                    '--js-runtimes', `node:${process.env.NODE_PATH || '/usr/local/bin/node'}`
                ]);

                queue.currentProcess = proc; // Store process for future cleanup

                proc.stderr.on('data', (data) => {
                    const msg = data.toString();
                    if (msg.includes('Error') || msg.includes('error')) console.error(`[Stream Error] yt-dlp: ${msg.trim()}`);
                });

                resource = createAudioResource(proc.stdout);
            }
        } catch (e) {
            console.error(`[Stream] yt-dlp failed: ${e.message}`);
        }

        player.play(resource);

        // --- DYNAMIC PRESENCE (V5.2.8) ---
        const updatePresence = (clientObj, currentMs = 0) => {
            if (!clientObj?.user) return;
            const timeStr = currentMs > 0 ? `[${Math.floor(currentMs/60000)}:${Math.floor((currentMs%60000)/1000).toString().padStart(2,'0')}] ` : '';
            clientObj.user.setActivity({
                name: 'AH Music',
                type: ActivityType.Listening,
                details: `${track.title.slice(0, 127)}`,
                state: `by ${track.author.slice(0, 127)}`,
                largeImageKey: 'icon', // Fallback for various clients
                largeImageText: `${timeStr}V${version} | Q: ${queue.songs.length}`.slice(0, 127)
            });
        };

        if (interaction) {
            updatePresence(interaction.client);
        } else if (queue.textChannel) {
            updatePresence(queue.textChannel.client);
        }

        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pause_resume').setLabel('Pause / Resume').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('skip').setLabel('Skip Track').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('stop').setLabel('Stop & Clear').setStyle(ButtonStyle.Danger)
        );
        
        const syncStepMs = parseInt(process.env.LYRIC_SYNC_STEP_MS) || 1000;
        const syncStepSec = (syncStepMs / 1000).toFixed(1);
        
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('sync_minus').setLabel(`Sync -${syncStepSec}s`).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('sync_plus').setLabel(`Sync +${syncStepSec}s`).setStyle(ButtonStyle.Secondary)
        );

        if (!isLive) {
            row2.addComponents(
                new ButtonBuilder().setCustomId('download').setLabel('Download Audio').setStyle(ButtonStyle.Success)
            );
        }


        const durationStr = track.totalDurationMs === 0 ? 'LIVE' : `${Math.floor(track.totalDurationMs / 60000)}:${Math.floor((track.totalDurationMs % 60000) / 1000).toString().padStart(2, '0')}`;
        
        // Fetch lyrics early (don't block audio playback)
        if (track.totalDurationMs > 0) {
            fetchSyncedLyrics(track.title, track.author, track.totalDurationMs / 1000, track.query, track.actualUrl).then(results => {
                track.syncedLyrics = results;
            }).catch(err => console.warn('[Lyrics] Initial fetch failed:', err.message));
        } else {
            console.log(`[Lyrics] Skipping fetch for live stream: ${track.title}`);
        }

        const generateEmbed = (currentMs) => {
            const totalBars = 33; // Solid length for block bar
            const progress = track.totalDurationMs > 0 ? Math.min(currentMs / track.totalDurationMs, 1) : 0;
            const progressIndex = Math.floor(progress * totalBars);
            
            let bar = '';
            for (let i = 0; i < totalBars; i++) {
                if (i < progressIndex) bar += '▓';
                else if (i === progressIndex) bar += '█';
                else bar += '░';
            }

            const currentStr = `${Math.floor(currentMs / 60000)}:${Math.floor((currentMs % 60000) / 1000).toString().padStart(2, '0')}`;
            const reqValue = track.requester === 'Autoplay' ? 'Autoplay' : `<@${track.requester}>`;

            const manualOffsetMs = queue.lyricOffsetMs || 0;
            const autoOffsetMs = track.introOffsetMs || 0;
            const totalOffsetMs = autoOffsetMs + manualOffsetMs;

            let description = `**${track.title}**\n*by ${track.author}*\n\n\`${currentStr} / ${durationStr}\`\n${bar}`;
            
            if (totalOffsetMs !== 0) {
                const sign = totalOffsetMs > 0 ? '+' : '';
                description += `\n\n\`Sync: ${sign}${totalOffsetMs}ms (${autoOffsetMs}ms Intro | ${manualOffsetMs}ms Manual)\``;
            }

            if (track.syncedLyrics && track.syncedLyrics.lyrics && track.syncedLyrics.lyrics.length > 0) {
                const adjustedMs = currentMs - totalOffsetMs;
                const lines = track.syncedLyrics.lyrics;
                const index = lines.findLastIndex(l => l.time <= adjustedMs);
                
                if (index !== -1) {
                    const prev = lines[index - 1] ? `\n*${lines[index - 1].text}*` : "";
                    const current = `\n**${lines[index].text}**`;
                    const next = lines[index + 1] ? `\n*${lines[index + 1].text}*` : "";
                    description += `\n\nLyrics\n${prev}${current}${next}`;
                }
            }

            description += `\n\nRequested by: ${reqValue} | Channel: <#${queue.voiceChannel.id}>`;

            return new EmbedBuilder()
                .setTitle('Now Playing')
                .setDescription(description)
                .setThumbnail(track.thumbnail)
                .setColor(0x2B2D31);
        };

        const rows = [row1];
        if (row2.components.length > 0) rows.push(row2);

        let replyMessage;
        if (interaction) {
             replyMessage = await interaction.editReply({ embeds: [generateEmbed(0)], components: rows, fetchReply: true }).catch(() => null);
        } else if (queue.textChannel) {
             replyMessage = await queue.textChannel.send({ embeds: [generateEmbed(0)], components: rows }).catch(() => null);
        }

        let lastKnownLyricIndex = -1;
        let lastUpdateMs = 0;

        const progressInterval = setInterval(async () => {
            if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
                clearInterval(progressInterval);
                return;
            }
            
            const currentMs = resource.playbackDuration || 0;
            const currentLyricIndex = (track.syncedLyrics && track.syncedLyrics.lyrics) 
                ? track.syncedLyrics.lyrics.findLastIndex(l => {
                    const autoOffsetMs = track.introOffsetMs || 0;
                    const manualOffsetMs = queue.lyricOffsetMs || 0;
                    const offsetMs = autoOffsetMs + manualOffsetMs;
                    return l.time <= currentMs - offsetMs;
                }) 
                : -1;

            if (player.state.status === 'playing' && replyMessage) {
                // Update only if local lyric line changed OR 5 seconds passed since last progress bar update
                if (currentLyricIndex !== lastKnownLyricIndex || (currentMs - lastUpdateMs) >= 5000) {
                    lastKnownLyricIndex = currentLyricIndex;
                    lastUpdateMs = currentMs;

                    // Periodic Presence Refresh (Time Sync)
                    const clientObj = interaction ? interaction.client : (queue.textChannel ? queue.textChannel.client : null);
                    if (clientObj) updatePresence(clientObj, currentMs);

                    try {
                        await replyMessage.edit({ embeds: [generateEmbed(currentMs)] });
                    } catch (err) {
                        clearInterval(progressInterval);
                    }
                }
            }
        }, 1000);

        if (queue.progressInterval) clearInterval(queue.progressInterval);
        queue.progressInterval = progressInterval;
    },

    cleanup: (guildId, queueMap) => {
        const queue = queueMap.get(guildId);
        if (!queue) return;

        if (queue.currentProcess) {
            console.log(`[Cleanup] Explicitly killing process for Guild ${guildId}`);
            queue.currentProcess.kill('SIGKILL');
            queue.currentProcess = null;
        }
        
        if (queue.progressInterval) {
            clearInterval(queue.progressInterval);
        }
    }
};

// Explicitly assign for external access
module.exports.playNextSong = module.exports.playNextSong_impl = module.exports.playNextSong;


async function fetchSyncedLyrics(trackName, artistName, durationSec, originalQuery, videoUrl, skipFirst = false) {
    console.log(`[Lyrics] Fetching: "${trackName}" by "${artistName}" (${durationSec}s)`);
    try {
        let artist = (artistName || "").replace(/ - Topic|Official|VEVO|Music|Video/gi, '').trim();
        let track = (trackName || "").replace(/\(Official Video\)|\(Lyrics\)|\(OFFICIAL\)|\(Music Video\)|\[Official\]|\[Lyric Video\]|\|.*/gi, '').replace(/\(.*\)|\[.*\]/g, '').trim();

        if (trackName.includes(' - ')) {
            const parts = trackName.split(' - ');
            artist = parts[0].replace(/Official|VEVO|Music|Video/gi, '').trim();
            track = parts[1].replace(/\(Official Video\)|\(Lyrics\)|\(OFFICIAL\)|\(Music Video\)|\[Official\]|\[Lyric Video\]|\|.*/gi, '').replace(/\(.*\)|\[.*\]/g, '').trim();
        }

        const queryUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}&duration=${Math.floor(durationSec)}`;
        
        let response = await fetch(queryUrl);
        if (response.ok) {
            const data = await response.json();
            if (data.syncedLyrics) return { lyrics: parseLRC(data.syncedLyrics), duration: data.duration };
        }

        // Search fallback 1: Using extracted metadata
        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${track}`)}`;
        response = await fetch(searchUrl);
        if (response.ok) {
            const results = await response.json();
            let matched = results.filter(r => r.syncedLyrics && Math.abs(r.duration - durationSec) < 60);
            
            if (skipFirst && matched.length > 1) {
                // Shift results or pick next one
                matched = matched.slice(1);
            }
            
            const best = matched.sort((a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec))[0];

            if (best) {
                console.log(`[Lyrics] Search fallback found: "${best.trackName}" (${best.duration}s)`);
                return { lyrics: parseLRC(best.syncedLyrics), duration: best.duration };
            }
        }

        // Search fallback 2: Using the user's original query (if it's not a URL)
        if (originalQuery && !originalQuery.startsWith('http')) {
            console.log(`[Lyrics] Trying final query fallback: "${originalQuery}"`);
            const finalSearchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(originalQuery)}`;
            response = await fetch(finalSearchUrl);
            if (response.ok) {
                const results = await response.json();
                const best = results
                    .filter(r => r.syncedLyrics && Math.abs(r.duration - durationSec) < 60)
                    .sort((a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec))[0];

                if (best) {
                    console.log(`[Lyrics] Query fallback found: "${best.trackName}" (${best.duration}s)`);
                    return { lyrics: parseLRC(best.syncedLyrics), duration: best.duration };
                }
            }
        }

        // Search fallback 3: YouTube Subtitles/Captions
        if (videoUrl && videoUrl.includes('youtube.com')) {
            console.log(`[Lyrics] No synced lyrics on LRCLIB, checking YouTube subtitles...`);
            const ytSubs = await fetchYouTubeSubtitles(videoUrl);
            if (ytSubs) return ytSubs;
        }

        return null;
    } catch (error) {
        console.error('[Lyrics] Fetch error:', error.message);
        return null;
    }
}


async function fetchYouTubeSubtitles(url) {
    try {
        const json = await youtubedl(url, {
            dumpSingleJson: true,
            writeAutoSubs: true,
            noCheckCertificates: true,
            noWarnings: true
        }).catch(() => null);

        if (!json) return null;

        const subs = json.subtitles || {};
        const autoSubs = json.automatic_captions || {};
        
        // Find best English track (manual preferred over auto)
        const enKey = Object.keys(subs).find(k => k.startsWith('en')) || 
                     Object.keys(autoSubs).find(k => k.startsWith('en'));
        
        if (!enKey) return null;

        const formats = subs[enKey] || autoSubs[enKey];
        const vttFormat = formats.find(f => f.ext === 'vtt');
        if (!vttFormat) return null;

        const response = await fetch(vttFormat.url);
        if (!response.ok) return null;
        
        const vttText = await response.text();
        const lyrics = parseVTT(vttText);
        
        if (lyrics.length > 0) {
            console.log(`[Lyrics] YouTube captions found (${enKey})`);
            return { lyrics, duration: json.duration };
        }
    } catch (err) {
        console.warn(`[Lyrics] YouTube sub fetch failed: ${err.message}`);
    }
    return null;
}

function parseVTT(vtt) {
    const lines = vtt.split('\n');
    const lyrics = [];
    const timeRegex = /(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const match = timeRegex.exec(line);
        if (match) {
            const startStr = match[1];
            const parts = startStr.split(':');
            const hours = parseInt(parts[0]);
            const minutes = parseInt(parts[1]);
            const seconds = parseFloat(parts[2]);
            const timeMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
            
            let text = "";
            let j = i + 1;
            while (j < lines.length && lines[j].trim() !== "" && !timeRegex.test(lines[j])) {
                text += (text ? " " : "") + lines[j].trim();
                j++;
            }
            if (text) {
                const cleanText = (text || "")
                    .replace(/<[^>]*>/g, '') // Remove HTML
                    .replace(/\[[^\]]*\]/g, '') // Remove [Music], [Applause]
                    .replace(/\([^\)]*\)/g, '') // Remove (Laughter)
                    .replace(/♪/g, '') // Remove music notes
                    .replace(/^- /g, '') // Remove leading dashes
                    .trim();
                if (cleanText) lyrics.push({ time: timeMs, text: cleanText });
            }
            i = j - 1;
        }
    }
    return lyrics;
}


function parseLRC(lrc) {
    const lines = lrc.split('\n');
    const lyrics = [];
    const timeRegex = /\[(\d+):(\d+\.\d+)\]/;

    for (const line of lines) {
        const match = timeRegex.exec(line);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseFloat(match[2]);
            const timeMs = (minutes * 60 + seconds) * 1000;
            const text = line.split(']').slice(1).join(']').trim();
            if (text) {
                lyrics.push({ time: timeMs, text });
            }
        }
    }
    return lyrics;
}
