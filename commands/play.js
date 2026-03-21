const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, VoiceConnectionStatus, AudioPlayerStatus } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from any source')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The song URL or search query')
                .setRequired(true)),
    async execute(interaction) {
        const query = interaction.options.getString('query');
        return module.exports.handlePlay(interaction, query);
    },
    async handlePlay(interaction, query) {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply({ content: 'You are not connected to a voice channel!', ephemeral: true });
        
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
        
        // Immediate feedback to clear "thinking..." state
        const loadingEmbed = new EmbedBuilder()
            .setTitle('Sᴇᴀʀᴄʜɪɴɢ...')
            .setDescription(`Searching for: **${query}**`)
            .setColor(0x2B2D31);
        await interaction.editReply({ embeds: [loadingEmbed] }).catch(() => null);

        try {
            let title, thumbnail, author, actualUrl, totalDurationMs, youtubeId, introOffsetMs = 0;
            const MUSIC_CHAPTER_REGEX = /music|song|start|feeka|sukoon|play/i;

            // Use yt-dlp for search and metadata
             try {
                const urlQuery = query.startsWith('http') ? query : `ytsearch1:${query}`;
                const info = await youtubedl(urlQuery, { 
                    dumpSingleJson: true, noCheckCertificates: true, noWarnings: true
                });
                const entry = info.entries ? info.entries[0] : info;
                if (!entry) throw new Error('No results');
                title = entry.title || 'Unknown Track';
                thumbnail = entry.thumbnail || 'https://cdn.discordapp.com/embed/avatars/0.png';
                author = entry.uploader || 'Unknown Artist';
                actualUrl = entry.webpage_url || query;
                totalDurationMs = (entry.is_live || entry.live_status === 'is_live') ? 0 : (entry.duration || 0) * 1000;
                youtubeId = entry.id;

                // Check for chapters to find intro offset
                if (entry.chapters && entry.chapters.length > 0) {
                    const musicChapter = entry.chapters.find(c => MUSIC_CHAPTER_REGEX.test(c.title));
                    if (musicChapter && musicChapter.start_time > 0) {
                        introOffsetMs = musicChapter.start_time * 1000;
                        console.log(`[Lyrics] Detected intro offset from chapter: ${introOffsetMs}ms (${musicChapter.title})`);
                    }
                }
            } catch (searchErr) {
                console.error('[Play] yt-dlp search failed:', searchErr.message);
                return interaction.followUp("❌ Request failed - could not find the song or it may be private.");
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
                return interaction.followUp({ embeds: [addEmbed] });
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

                playNextSong(interaction.guild.id, queueMap, interaction);

            } catch (err) {
                console.error(err);
                queueMap.delete(interaction.guild.id);
                return interaction.followUp("❌ Could not join the voice channel.");
            }

        } catch (e) {
            console.error(e);
            return interaction.followUp(`Something went wrong: ${e.message}`);
        }
    }
};


async function fetchSyncedLyrics(trackName, artistName, durationSec, originalQuery, videoUrl) {
    console.log(`[Lyrics] Fetching: "${trackName}" by "${artistName}" (${durationSec}s)`);
    try {
        let artist = artistName.replace(' - Topic', '').trim();
        let track = trackName.replace(/\(.*\)|\[.*\]|\|.*/g, '').trim();

        if (trackName.includes(' - ')) {
            const parts = trackName.split(' - ');
            artist = parts[0].trim();
            track = parts[1].replace(/\(.*\)|\[.*\]|\|.*/g, '').trim();
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
            const best = results
                .filter(r => r.syncedLyrics && Math.abs(r.duration - durationSec) < 60)
                .sort((a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec))[0];

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
                const cleanText = text.replace(/<[^>]*>/g, '').replace(/^- |^\[|\]$/g, '').trim();
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

async function playNextSong(guildId, queueMap, interaction) {
    const queue = queueMap.get(guildId);
    
    if (queue && queue.songs.length === 0 && queue.lastPlayedId) {
        try {
            await queue.textChannel.send({ content: "🔄 Generating the next Up-Next Autoplay track natively..." }).catch(() => null);
            const mixUrl = `https://www.youtube.com/watch?v=${queue.lastPlayedId}&list=RD${queue.lastPlayedId}`;
            const info = await youtubedl(mixUrl, { 
                dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, 
                playlistItems: '2', extractAudio: true
            }).catch(() => null);
            
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
        queueMap.delete(guildId);
        return;
    }

    const track = queue.songs[0];
    queue.lastPlayedId = track.youtubeId;

    const player = createAudioPlayer({
        behaviors: { noSubscriber: 'pause' },
    });
    queue.player = player;
    queue.connection.subscribe(player);

    const isLive = track.totalDurationMs === 0;

    // Stream directly via yt-dlp (uses system ffmpeg)
    try {
        if (isLive) {
            // Get the direct m3u8 playlist URL from yt-dlp (no ffmpeg needed for this)
            const m3u8Url = await youtubedl(track.actualUrl, {
                getUrl: true,
                f: 'best[protocol=m3u8_native]/best',
                noCheckCertificates: true
            }).catch(() => null);

            if (m3u8Url) {
                const { PassThrough } = require('stream');
                const https = require('https');
                const http = require('http');
                const pass = new PassThrough();

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

                // Parse and stream HLS segments without ffmpeg
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
                        await new Promise(r => setTimeout(r, 2000));
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
            const proc = youtubedl.exec(track.actualUrl, {
                o: '-',
                q: '',
                f: 'bestaudio[ext=webm]/bestaudio/best',
                noCheckCertificates: true
            }, { stdio: ['ignore', 'pipe', 'pipe'] });

            proc.stderr.on('data', (data) => {
                const msg = data.toString();
                if (msg.includes('Error') || msg.includes('error')) console.error(`[Stream] yt-dlp: ${msg.trim()}`);
            });

            resource = createAudioResource(proc.stdout);
        }
    } catch (e) {
        console.error(`[Stream] yt-dlp failed: ${e.message}`);
    }

    player.play(resource);

    player.on('error', error => {
        console.error(`[Player Error] ${error.message} - skipping track...`);
        player.stop(); // This will trigger Idle and shift
    });

    player.on('stateChange', (oldState, newState) => {
        if (newState.status !== oldState.status) {
            console.log(`[Player Status] ${oldState.status} -> ${newState.status}`);
        }
    });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pause_resume').setLabel('Pause / Resume Playback').setEmoji('⏯️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('skip').setLabel('Skip Current Track').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('stop').setLabel('Stop and Clear Queue').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sync_minus').setLabel('Adjust Sync -1.0s').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('sync_plus').setLabel('Adjust Sync +1.0s').setEmoji('⏩').setStyle(ButtonStyle.Secondary)
    );

    if (!isLive) {
        row2.addComponents(
            new ButtonBuilder().setCustomId('download').setLabel('Download Audio File').setEmoji('⬇️').setStyle(ButtonStyle.Success)
        );
    }


    const durationStr = track.totalDurationMs === 0 ? 'LIVE' : `${Math.floor(track.totalDurationMs / 60000)}:${Math.floor((track.totalDurationMs % 60000) / 1000).toString().padStart(2, '0')}`;
    
    // Fetch lyrics early (don't block audio playback)
    // SKIP for live streams (duration 0)
    let syncedLyrics = null;
    if (track.totalDurationMs > 0) {
        fetchSyncedLyrics(track.title, track.author, track.totalDurationMs / 1000, track.query, track.actualUrl).then(results => {
            syncedLyrics = results;
        }).catch(err => console.warn('[Lyrics] Initial fetch failed:', err.message));
    } else {
        console.log(`[Lyrics] Skipping fetch for live stream: ${track.title}`);
    }

    const generateEmbed = (currentMs) => {
        try {
            const totalBars = 45; // Maximize width
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

            let description = `**${track.title}**\n*by ${track.author}*\n\n\`${currentStr} / ${durationStr}\`\n${bar}`;

            if (syncedLyrics && syncedLyrics.lyrics && syncedLyrics.lyrics.length > 0) {
                const manualOffsetMs = queue.lyricOffsetMs || 0;
                const autoOffsetMs = track.introOffsetMs || 0;
                const offsetMs = autoOffsetMs + manualOffsetMs;
                const adjustedMs = currentMs - offsetMs;
                const lines = syncedLyrics.lyrics;
                const index = lines.findLastIndex(l => l.time <= adjustedMs);
                
                if (index !== -1) {
                    const prev = lines[index - 1] ? `\n*${lines[index - 1].text}*` : "";
                    const current = `\n**${lines[index].text}**`;
                    const next = lines[index + 1] ? `\n*${lines[index + 1].text}*` : "";
                    description += `\n\n🎵 **Lyrics**\n${prev}${current}${next}`;
                } else if (adjustedMs < 0) {
                    description += `\n\n🎵 **Lyrics**\n*... Intro ...*`;
                }

                if (manualOffsetMs !== 0) {
                    const offsetSec = (manualOffsetMs / 1000).toFixed(1);
                    description += `\n\n\`Sync Offset: ${offsetSec > 0 ? '+' : ''}${offsetSec}s\``;
                }
            }

            description += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 **Requested by**: ${reqValue}  |  🔊 **Channel**: ${queue.voiceChannel ? `<#${queue.voiceChannel.id}>` : 'Unknown'}`;

            return new EmbedBuilder()
                .setTitle('Now Playing')
                .setDescription(description.substring(0, 4000))
                .setThumbnail(track.thumbnail)
                .setColor(0x2B2D31);
        } catch (e) {
            console.error('[Embed Error]', e);
            return new EmbedBuilder().setTitle('Playback starting...').setDescription(track.title).setColor(0x2B2D31);
        }
    };

    const rows = [row1];
    if (row2.components.length > 0) {
        rows.push(row2);
    }

    let replyMessage;
    try {
        if (interaction) {
            console.log(`[Interaction] Rendering playback embed for: ${track.title}`);
            const embed = generateEmbed(0);
            
            // Try to edit the "Searching..." reply
            try {
                replyMessage = await interaction.editReply({ 
                    embeds: [embed], 
                    components: rows 
                });
                console.log(`[Interaction] SUCCESS: Player embed sent.`);
            } catch (editError) {
                console.warn(`[Interaction] editReply failed (probably expired), trying followUp:`, editError.message);
                replyMessage = await interaction.followUp({ 
                    embeds: [embed], 
                    components: rows 
                }).catch(e => console.error(`[Interaction] FATAL: followUp failed:`, e.message));
            }
        } else {
            console.log(`[Queue] Sending channel message for ${track.title}...`);
            replyMessage = await queue.textChannel.send({ embeds: [generateEmbed(0)], components: rows });
        }
    } catch (sendError) {
        console.error('[Playback] Critical send failure:', sendError);
        if (interaction) {
            await interaction.followUp({ content: `Now Playing: **${track.title}** (The premium embed failed to load, please check logs).` }).catch(() => null);
        }
    }

    let lastKnownLyricIndex = -1;
    let lastUpdateMs = 0;

    const progressInterval = setInterval(async () => {
        if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
            clearInterval(progressInterval);
            return;
        }
        
        const currentMs = resource.playbackDuration || 0;
        const currentLyricIndex = (syncedLyrics && syncedLyrics.lyrics) 
            ? syncedLyrics.lyrics.findLastIndex(l => {
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
                try {
                    await replyMessage.edit({ embeds: [generateEmbed(currentMs)] });
                } catch (err) {
                    clearInterval(progressInterval);
                }
            }
        }
    }, 1000);

    player.on(AudioPlayerStatus.Idle, () => {
        console.log(`[Queue] Track ended/skipped. Next up...`);
        clearInterval(progressInterval);
        queue.songs.shift(); 
        playNextSong(guildId, queueMap, null);
    });
}
