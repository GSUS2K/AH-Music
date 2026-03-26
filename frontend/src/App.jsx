import { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, Zap, Search, Plus, Loader2, ListMusic, Music, Globe, User, BookOpen, Trash2, Rewind, FastForward, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { setupDiscordSdk } from './discord';
import axios from 'axios';
import './App.css';

const getApiBase = () => {
  if (typeof window !== 'undefined') {
    return window.location.pathname.startsWith('/activity') ? '/activity' : '';
  }
  return '';
};
const API_BASE = getApiBase();

const remoteLog = (msg, err = '') => {
  axios.post(`${API_BASE}/api/log`, { message: msg, error: err }).catch(() => {});
};

function App() {
  const [auth, setAuth] = useState(null);
  const discordSdkRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [voiceChannel, setVoiceChannel] = useState('Unknown');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentTime, setCurrentTime] = useState(0); 
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0); 
  const [lyrics, setLyrics] = useState([]); 
  
  // Lyrics State
  const [isLyricsLoading, setIsLyricsLoading] = useState(false);
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
  const [systemStats, setSystemStats] = useState(null);
  const lyricRef = useRef(null);
  const activeLyricRef = useRef(null);

  // Search & Interactivity
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingIds, setAddingIds] = useState(new Set());
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const scrollTimeoutRef = useRef(null);
  const [lastAdded, setLastAdded] = useState(null);

  const getProxyUrl = (url) => url ? `${API_BASE}/api/proxy?url=${encodeURIComponent(url)}` : null;

  useEffect(() => {
    // We removed the strict frame_id check to prevent false-negative blank screens.
    // The app will now always attempt to boot.
    
    let pollInterval;
    const initDiscord = async () => {
      try {
        console.log("Starting SDK Init...");
        remoteLog("Starting SDK Init on " + API_BASE);
        const { sdk, auth: authData } = await setupDiscordSdk();
        discordSdkRef.current = sdk;
        
        if (sdk) {
          console.log("SDK Ready. Guild:", sdk.guildId);
          remoteLog("SDK Ready. Guild: " + sdk.guildId);
          if (authData) {
            setAuth(authData);
            remoteLog("Full Auth Successful for " + authData.user.username);
          } else {
            console.warn('Handshake failed or skipped, using Guest Context');
            setAuth({
              guild_id: sdk.guildId,
              channel_id: sdk.channelId,
              user: { id: 'GuestUser', username: 'CONNECTED' }
            });
          }
          
          if (sdk.guildId) {
            fetchQueue(sdk.guildId);
            pollInterval = setInterval(() => fetchQueue(sdk.guildId), 5000);
          }
        } else {
          throw new Error("SDK instance was not created");
        }
      } catch (err) {
        console.error('Safe-Boot Triggered:', err);
        // Emergency Fallback: If SDK fails entirely, we still show the UI
        // and let the user try to search/play (it might work if backend is reachable)
        setError(null); 
        setAuth({
          guild_id: new URLSearchParams(window.location.search).get('guild_id') || '0',
          user: { id: 'Guest', username: 'OFFLINE MODE' }
        });
      } finally {
        setLoading(false);
      }
    };

    initDiscord();
    console.log("Current API_BASE:", API_BASE);
    remoteLog("Current API_BASE: " + API_BASE);
    fetchSystemStats();
    const statsInterval = setInterval(fetchSystemStats, 10000);
    return () => {
      clearInterval(pollInterval);
      clearInterval(statsInterval);
    };
  }, []);

  const fetchQueue = async (guildId) => {
    if (!guildId || guildId === '0') return;
    try {
      const resp = await axios.get(`${API_BASE}/api/queue/${guildId}`);
      setIsPlaying(resp.data.isPlaying);
      setVoiceChannel(resp.data.voiceChannel || 'Unknown');
      setLyricOffsetMs(resp.data.lyricOffsetMs || 0);
      
      const serverSongs = resp.data.songs || [];
      setQueue(serverSongs);
      
      if (serverSongs.length > 0) {
        // Sync local clock with server if drift > 1000ms (wider window to avoid jumping)
        const serverMs = resp.data.currentMs || 0;
        const drift = Math.abs(currentTime - serverMs);
        if (drift > 1000 || currentTime === 0) {
          setCurrentTime(serverMs);
        }
      }
    } catch (err) {
      if (err.response?.status === 404) setQueue([]);
    }
  };

  const fetchSystemStats = async () => {
    try {
      const resp = await axios.get(`${API_BASE}/api/system`);
      setSystemStats(resp.data);
    } catch (err) { console.error("Telemetry error:", err); }
  };

  const currentTrack = queue?.[0];

  // Sync internal clock for scrolling lyrics
  useEffect(() => {
    let interval;
    if (isPlaying && currentTrack) {
        interval = setInterval(() => {
            setCurrentTime(prev => prev + 250); // Higher resolution for smoother scroll
        }, 250);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentTrack]);

  // Handle active lyric index calculation in a side-effect (safe from render loop)
  useEffect(() => {
    if (!lyrics || lyrics.length === 0) {
      setActiveLyricIndex(-1);
      return;
    }
    const offsetMs = (currentTrack?.introOffsetMs || 0) + (lyricOffsetMs || 0);
    const effectiveTime = currentTime - offsetMs;
    
    const idx = lyrics.findLastIndex(l => l.time <= effectiveTime);
    if (idx !== -1 && idx !== activeLyricIndex) {
      setActiveLyricIndex(idx);
    }
  }, [currentTime, lyrics, currentTrack?.introOffsetMs, lyricOffsetMs]);

  // Handle auto-scroll only when index changes
  useEffect(() => {
    if (activeLyricRef.current && !isAutoScrollPaused) {
        activeLyricRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLyricIndex, isAutoScrollPaused]);

  const handleManualScroll = () => {
    setIsAutoScrollPaused(true);
    if (window.scrollTimeout) clearTimeout(window.scrollTimeout);
    window.scrollTimeout = setTimeout(() => {
      setIsAutoScrollPaused(false);
    }, 10000); // 10s pause
  };

  const [currentTrackTitle, setCurrentTrackTitle] = useState("");

  const fetchLyrics = async (trackTitle, trackAuthor, trackDuration, trackUrl) => {
    if (!trackTitle) return;
    setIsLyricsLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/lyrics?track=${encodeURIComponent(trackTitle)}&artist=${encodeURIComponent(trackAuthor || '')}&duration=${(trackDuration || 0)/1000}&url=${encodeURIComponent(trackUrl || '')}&format=json`);
      const data = await resp.json();
      setLyrics(Array.isArray(data) ? data : []);
      
      // Only reset clock if the track title changed
      if (trackTitle !== currentTrackTitle) {
        setCurrentTime(0);
        setCurrentTrackTitle(trackTitle);
      }
    } catch (err) {
      console.error("Lyrics fetch failed:", err);
      setLyrics([]);
    } finally {
      setIsLyricsLoading(false);
    }
  };

  useEffect(() => {
    // Reset clock and title tracking when track changes
    if (currentTrack?.title !== currentTrackTitle) {
      setCurrentTime(0);
      setCurrentTrackTitle(currentTrack?.title || "");
    }

    if (currentTrack?.syncedLyrics) {
        setLyrics(currentTrack.syncedLyrics.lyrics || []);
    } else if (currentTrack?.title) {
        fetchLyrics(currentTrack.title, currentTrack.author, currentTrack.duration, currentTrack.actualUrl);
    } else {
        setLyrics([]);
    }
  }, [currentTrack?.title]);

  // Synchronize Discord Activity Status
  useEffect(() => {
    const updateStatus = async () => {
      if (!discordSdkRef.current || !auth?.user || auth.user.id === 'GuestUser' || auth.user.id === 'Guest') {
        return;
      }

      try {
        if (currentTrack && isPlaying) {
          const start = Date.now() - (currentTime || 0);
          const end = start + (currentTrack.duration || currentTrack.totalDurationMs || 0);

          await discordSdkRef.current.commands.setActivity({
            activity: {
              type: 0, // Using 0 (Playing) to ensure better compatibility across Discord clients
              details: currentTrack.title.substring(0, 127),
              state: `by ${currentTrack.author}`.substring(0, 127),
              assets: {
                large_image: currentTrack.thumbnail,
                large_text: currentTrack.title.substring(0, 127),
              },
              timestamps: {
                start,
                end,
              },
              // Join secret enables the "Join Activity" button for others
              secrets: {
                join: auth.guild_id || 'guest',
              },
              instance: true,
            },
          });
          console.log('[Activity] Status synced to Profile');
        } else {
          // Clear activity or set to idling
          await discordSdkRef.current.commands.setActivity({
            activity: {
              type: 0,
              details: "Browsing the network",
              state: "Idling",
              instance: true,
            }
          });
          console.log('[Activity] Status cleared/idled');
        }
      } catch (err) {
        console.warn('[Activity] Status Sync failed:', err.message);
      }
    };

    updateStatus();
  }, [currentTrack, isPlaying, auth?.user?.id]);

  const handleControl = async (action) => {
    const guildId = auth?.guild_id || new URLSearchParams(window.location.search).get('guild_id');
    if (!guildId || guildId === '0') return;
    try {
      await axios.post(`${API_BASE}/api/control/${guildId}`, { action });
      fetchQueue(guildId);
    } catch (err) { console.error("Control error:", err); }
  };

  const handleRemove = async (index) => {
    const guildId = auth?.guild_id || new URLSearchParams(window.location.search).get('guild_id');
    if (!guildId || guildId === '0') return;
    try {
      await axios.post(`${API_BASE}/api/remove/${guildId}/${index}`);
      fetchQueue(guildId);
    } catch (err) { console.error("Remove error:", err); }
  };

  const handleSync = async (offset) => {
    if (!auth?.guild_id) return;
    try {
      await axios.post(`${API_BASE}/api/sync/${auth.guild_id}`, { offset });
      fetchQueue(auth.guild_id);
    } catch (err) { console.error("Sync error:", err); }
  };

  const handleSource = async () => {
    if (!auth?.guild_id) return;
    setIsLyricsLoading(true);
    try {
      const resp = await axios.post(`${API_BASE}/api/source/${auth.guild_id}`);
      setLyrics(resp.data.lyrics);
    } catch (err) { 
      console.error("Source error:", err);
      alert("No additional lyric sources found for this track.");
    } finally {
      setIsLyricsLoading(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const resp = await axios.get(`${API_BASE}/api/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(resp.data);
    } catch (err) { console.error('Search error:', err); }
    finally { setIsSearching(false); }
  };

  const handleAdd = async (track) => {
    const guildId = auth?.guild_id || new URLSearchParams(window.location.search).get('guild_id');
    const userId = auth?.user?.id || 'ActivityUser';
    
    if (!guildId || guildId === '0') {
        remoteLog("Click denied: Missing Guild Context", track.title);
        alert("Please open this activity in a Server (Guild) to add music.");
        return;
    }
    remoteLog("Click accepted: Adding " + track.title + " to " + guildId);
    setAddingIds(prev => new Set(prev).add(track.id));
    try {
      await axios.post(`${API_BASE}/api/add/${guildId}`, { 
        track, userId
      });
      fetchQueue(guildId);
      setLastAdded(track.title);
      setTimeout(() => setLastAdded(null), 3000);
    } catch (err) {
      console.error("Add error:", err);
      if (err.response?.status === 404) alert("Please join a Voice Channel first.");
      else alert("Failed to add track: " + (err.response?.data?.error || err.message));
    } finally {
      setAddingIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  };

  if (loading) return (
    <div className="loading-screen">
      <Loader2 className="spinning" size={32} color="#00f2ff" />
      <span style={{ letterSpacing: '4px', fontSize: '12px' }}>INITIALIZING NEURAL LINK...</span>
    </div>
  );
  
  if (error) return <div className="loading-screen"><h1>SYSTEM ERROR</h1><p>{error}</p></div>;

  return (
    <div className="app-container">
      <div className="scanline" />
      <div className="vignette" />
      
      {currentTrack && (
        <div className="adaptive-bg" style={{ 
          backgroundImage: `url(${getProxyUrl(currentTrack.thumbnail)})`,
          opacity: isPlaying ? 0.35 : 0.15
        }} />
      )}
      <header className="header glass">
        <div className="logo">
          <Zap size={22} color="#00f2ff" />
          <span className="logo-text">{import.meta.env.VITE_APP_NAME || 'AH MUSIC'} <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>// v3.0-PREMIUM</span></span>
        </div>
        
        <div className="telemetry-panel hide-mobile">
          {systemStats && (
            <>
              <div className="stat-item">
                <span className="stat-label">RAM</span>
                <span className="stat-value">{systemStats.mem.percent}%</span>
                <div className="stat-bar-bg"><div className="stat-bar-fill" style={{ width: `${systemStats.mem.percent}%` }} /></div>
              </div>
              <div className="stat-item">
                <span className="stat-label">LOAD</span>
                <span className="stat-value">{systemStats.load}</span>
              </div>
            </>
          )}
        </div>

        <form onSubmit={handleSearch} className="search-bar-premium">
          <Search className="search-icon" size={18} />
          <input 
            type="text" 
            placeholder="Search the global music network..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {isSearching && <Loader2 className="spinning" size={18} style={{ position: 'absolute', right: '16px', color: '#00f2ff' }} />}
        </form>

        <div className="hide-mobile" style={{ display: 'flex', gap: '24px' }}>
          <div className="identity"><User size={14} /> <span>{auth?.user?.username || 'GUEST'}</span></div>
        </div>
      </header>

      <main className="main-content">
        
        <div className="hero-section">
          <section className="player-panel">
            <AnimatePresence mode="wait">
              {currentTrack ? (
                <motion.div 
                  key={currentTrack.title}
                  initial={{ opacity: 0, scale: 0.98, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 1.02, y: -20 }}
                  className={`player-card glass ${isPlaying ? 'playing' : ''}`}
                >
                  <div className="player-flex">
                    <div className="artwork-wrapper">
                      <div className="artwork-ambient" style={{ backgroundImage: `url(${getProxyUrl(currentTrack.thumbnail)})` }} />
                      <img 
                        src={getProxyUrl(currentTrack.thumbnail)} 
                        alt="Artwork" 
                        className="artwork-main" 
                        onError={(e) => {
                          console.warn("Main artwork failed to load:", e.target.src);
                          e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
                          remoteLog("Artwork Load Failure", currentTrack.thumbnail);
                        }}
                      />
                      <div className="visualizer" style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)' }}>
                        {[...Array(8)].map((_, i) => <div key={i} className="visual-bar" style={{ animationDelay: `${i*0.1}s` }} />)}
                      </div>
                    </div>
                    
                    <div className="track-info">
                      <span className="track-badge">STREAMING // {voiceChannel.toUpperCase()}</span>
                      <h1 className="track-title-hero">{currentTrack.title}</h1>
                      <p className="track-author-hero">by {currentTrack.author}</p>
                      
                      <div className="player-controls">
                        <button onClick={() => handleControl(isPlaying ? 'pause' : 'resume')} className="btn-circle primary" title={isPlaying ? 'Pause' : 'Play'}>
                          {isPlaying ? <Pause size={32} /> : <Play size={32} />}
                        </button>
                        <button onClick={() => handleControl('skip')} className="btn-circle secondary" title="Skip">
                          <SkipForward size={24} />
                        </button>
                        <button onClick={() => handleControl('clear')} className="btn-circle tertiary" title="Stop & Clear">
                          <Trash2 size={20} />
                        </button>
                      </div>

                      <div className="discovery-links">
                        <a href={currentTrack.actualUrl} target="_blank" rel="noopener noreferrer" className="btn-sync highlight" title="Source Link">
                           SOURCE <ExternalLink size={14} />
                        </a>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="player-card glass" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
                  <div style={{ textAlign: 'center', opacity: 0.5 }}>
                    <Music size={48} />
                    <h2 style={{ marginTop: '16px' }}>WAITING FOR LINK...</h2>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </section>

          <section className="lyrics-panel glass">
            <div className="lyrics-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <BookOpen size={16} /> <span>DYN-LYRICS ENGINE</span>
                </div>
                <div style={{ fontSize: '10px', opacity: 0.6, letterSpacing: '1px' }}>
                  SYNC: {((currentTrack?.introOffsetMs || 0) + (lyricOffsetMs || 0))}ms 
                  | {lyrics.length > 0 ? 'SOURCE: LINKED' : 'SEARCHING...'}
                </div>
            </div>
            
            <div className="sync-controls-mini glass" style={{ 
              display: 'flex', gap: '5px', padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)',
              justifyContent: 'center', alignItems: 'center'
            }}>
                <button title="-1s" onClick={() => handleSync(-1000)} className="btn-sync"><Rewind size={12} /></button>
                <button title="-500ms" onClick={() => handleSync(-500)} className="btn-sync"><ChevronLeft size={14} /></button>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '70px' }}>
                    <span style={{ fontSize: '11px', color: '#00f2ff', fontWeight: 'bold' }}>{lyricOffsetMs}ms</span>
                    <span style={{ fontSize: '8px', opacity: 0.5 }}>OFFSET</span>
                </div>
                <button title="+500ms" onClick={() => handleSync(500)} className="btn-sync"><ChevronRight size={14} /></button>
                <button title="+1s" onClick={() => handleSync(1000)} className="btn-sync"><FastForward size={12} /></button>
                <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 5px' }} />
                <button onClick={handleSource} className="btn-sync highlight" style={{ padding: '0 10px', fontSize: '10px' }}>ROTATE SOURCE</button>
            </div>

              <div 
                className="lyrics-content" 
                ref={lyricRef} 
                onWheel={handleManualScroll}
                onTouchStart={handleManualScroll}
                onScroll={handleManualScroll}
                style={{ 
                  height: '400px', 
                  overflowY: 'auto', 
                  padding: '20px',
                  position: 'relative',
                  scrollBehavior: 'smooth'
                }}
              >
                {isAutoScrollPaused && (
                  <div style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    fontSize: '10px',
                    color: '#ff9800',
                    zIndex: 10,
                    background: 'rgba(0,0,0,0.5)',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}>
                    AUTO-SCROLL PAUSED
                  </div>
                )}
              {isLyricsLoading ? (
                <div style={{ textAlign: 'center', padding: '40px' }}><Loader2 className="spinning" size={24} /></div>
              ) : lyrics.length > 0 ? (
                lyrics.map((line, idx) => {
                    const isActive = idx === activeLyricIndex;
                    return (
                        <div 
                          key={idx} 
                          ref={isActive ? activeLyricRef : null}
                          className={`lyric-line ${isActive ? 'active' : ''}`}
                        >
                            {line.text}
                        </div>
                    );
                })
              ) : (
                <div className="lyrics-placeholder">
                    SIGNAL LOST // SEARCHING GLOBAL DATABASE...
                </div>
              )}
            </div>
          </section>
        </div>

        {queue.length > 1 && (
          <section className="queue-section">
             <div className="section-label"><ListMusic size={14} /> UP NEXT ({queue.length - 1})</div>
             <div className="results-grid" style={{ marginTop: '20px' }}>
                {queue.slice(1).map((track, idx) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    key={`${track.id}-${idx}`}
                    className="track-card-mini"
                  >
                    <img src={getProxyUrl(track.thumbnail)} alt="" className="mini-artwork" />
                    <div className="mini-info">
                      <div className="mini-title text-accent">{track.title}</div>
                      <div className="mini-author">by {track.author}</div>
                    </div>
                    <button 
                      onClick={() => handleRemove(idx + 1)} 
                      className="btn-add-mini"
                      style={{ color: '#ff4b4b', borderColor: 'rgba(255,75,75,0.2)' }}
                      title="Remove from Queue"
                    >
                      <Trash2 size={16} />
                    </button>
                  </motion.div>
                ))}
             </div>
          </section>
        )}

        <section className="discovery-section">
          <div className="section-label"><Globe size={14} /> GLOBAL DISCOVERY</div>
          <div className="results-grid">
            <AnimatePresence>
              {searchResults.map((t) => (
                <motion.div 
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={t.id} 
                  className="track-card-mini"
                >
                  <img 
                    src={getProxyUrl(t.thumbnail)} 
                    alt="" 
                    className="mini-artwork" 
                    onError={(e) => {
                      e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
                    }}
                  />
                  <div className="mini-info">
                    <div className="mini-title">{t.title}</div>
                    <div className="mini-author">{t.author}</div>
                  </div>
                  <button 
                    onClick={() => handleAdd(t)} 
                    className="btn-add-mini"
                    disabled={addingIds.has(t.id)}
                  >
                    {addingIds.has(t.id) ? <Loader2 className="spinning" size={16} /> : <Plus size={16} />}
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
            {!isSearching && searchResults.length === 0 && (
                <div style={{ padding: '40px', textAlign: 'center', opacity: 0.3, gridColumn: '1/-1' }}>
                    <Search size={32} />
                    <p>Search above to explore the network</p>
                </div>
            )}
          </div>
        </section>

      </main>

      <AnimatePresence>
        {lastAdded && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: 50 }} 
            className="toast"
          >
            <Zap size={16} color="#00f2ff" />
            <span>QUEUED: {lastAdded.substring(0, 30)}...</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
