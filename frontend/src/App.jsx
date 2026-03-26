import { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, Search, Plus, Loader2, ListMusic, Music, Globe, User, BookOpen, Trash2, Rewind, FastForward, ExternalLink, ChevronLeft, ChevronRight, Zap } from 'lucide-react';
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

const formatTime = (ms) => {
  if (isNaN(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

function App() {
  const [auth, setAuth] = useState(null);
  const discordSdkRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [voiceChannel, setVoiceChannel] = useState('Unknown');
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0); 
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0); 
  const [lyrics, setLyrics] = useState([]); 
  const [isLyricsLoading, setIsLyricsLoading] = useState(false);
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
  const [systemStats, setSystemStats] = useState(null);
  const activeLyricRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingIds, setAddingIds] = useState(new Set());
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [lastAdded, setLastAdded] = useState(null);
  const [currentTrackTitle, setCurrentTrackTitle] = useState("");

  const getProxyUrl = (url) => url ? `${API_BASE}/api/proxy?url=${encodeURIComponent(url)}` : null;

  useEffect(() => {
    let pollInterval;
    const initDiscord = async () => {
      try {
        const { sdk, auth: authData } = await setupDiscordSdk();
        discordSdkRef.current = sdk;
        if (sdk) {
          if (authData) setAuth(authData);
          else setAuth({ guild_id: sdk.guildId, user: { id: 'Guest', username: 'GUEST' } });
          
          if (sdk.guildId) {
            fetchQueue(sdk.guildId);
            pollInterval = setInterval(() => fetchQueue(sdk.guildId), 5000);
          }
        }
      } catch (err) {
        setAuth({ guild_id: '0', user: { id: 'Offline', username: 'OFFLINE' } });
      } finally {
        setLoading(false);
      }
    };
    initDiscord();
    fetchSystemStats();
    const statsInterval = setInterval(fetchSystemStats, 10000);
    return () => { clearInterval(pollInterval); clearInterval(statsInterval); };
  }, []);

  const fetchQueue = async (guildId) => {
    if (!guildId || guildId === '0') return;
    try {
      const resp = await axios.get(`${API_BASE}/api/queue/${guildId}`);
      setIsPlaying(resp.data.isPlaying);
      setVoiceChannel(resp.data.voiceChannel || 'Unknown');
      setLyricOffsetMs(resp.data.lyricOffsetMs || 0);
      setQueue(resp.data.songs || []);
      
      const serverMs = resp.data.currentMs || 0;
      if (Math.abs(currentTime - serverMs) > 1000 || currentTime === 0) setCurrentTime(serverMs);
    } catch (err) {}
  };

  const fetchSystemStats = async () => {
    try {
      const resp = await axios.get(`${API_BASE}/api/system`);
      setSystemStats(resp.data);
    } catch (err) {}
  };

  const currentTrack = queue?.[0];

  useEffect(() => {
    let interval;
    if (isPlaying && currentTrack) {
        interval = setInterval(() => setCurrentTime(prev => prev + 250), 250);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentTrack]);

  useEffect(() => {
    if (!lyrics || lyrics.length === 0) { setActiveLyricIndex(-1); return; }
    const offsetMs = (currentTrack?.introOffsetMs || 0) + (lyricOffsetMs || 0);
    const idx = lyrics.findLastIndex(l => l.time <= (currentTime - offsetMs));
    if (idx !== -1 && idx !== activeLyricIndex) setActiveLyricIndex(idx);
  }, [currentTime, lyrics, lyricOffsetMs]);

  useEffect(() => {
    if (activeLyricRef.current && !isAutoScrollPaused) {
        activeLyricRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLyricIndex, isAutoScrollPaused]);

  const fetchLyrics = async (trackTitle, trackAuthor, trackDuration, trackUrl) => {
    if (!trackTitle) return;
    setIsLyricsLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/lyrics?track=${encodeURIComponent(trackTitle)}&artist=${encodeURIComponent(trackAuthor || '')}&duration=${(trackDuration || 0)/1000}&url=${encodeURIComponent(trackUrl || '')}&format=json`);
      const data = await resp.json();
      setLyrics(Array.isArray(data) ? data : []);
      if (trackTitle !== currentTrackTitle) {
        setCurrentTime(0);
        setCurrentTrackTitle(trackTitle);
      }
    } catch (err) { setLyrics([]); } finally { setIsLyricsLoading(false); }
  };

  useEffect(() => {
    if (currentTrack?.title !== currentTrackTitle) {
      setCurrentTime(0);
      setCurrentTrackTitle(currentTrack?.title || "");
    }
    if (currentTrack?.syncedLyrics) setLyrics(currentTrack.syncedLyrics.lyrics || []);
    else if (currentTrack?.title) fetchLyrics(currentTrack.title, currentTrack.author, currentTrack.totalDurationMs || currentTrack.duration, currentTrack.actualUrl);
    else setLyrics([]);
  }, [currentTrack?.title]);

  const handleControl = async (action) => {
    const guildId = auth?.guild_id || new URLSearchParams(window.location.search).get('guild_id');
    try { await axios.post(`${API_BASE}/api/control/${guildId}`, { action }); fetchQueue(guildId); } catch (err) {}
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const resp = await axios.get(`${API_BASE}/api/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(resp.data);
    } catch (err) {} finally { setIsSearching(false); }
  };

  const handleAdd = async (track) => {
    const guildId = auth?.guild_id || new URLSearchParams(window.location.search).get('guild_id');
    if (!guildId || guildId === '0') return alert("Join a server to play music.");
    setAddingIds(prev => new Set(prev).add(track.id));
    try {
      await axios.post(`${API_BASE}/api/add/${guildId}`, { track, userId: auth?.user?.id });
      fetchQueue(guildId);
      setLastAdded(track.title);
      setTimeout(() => setLastAdded(null), 3000);
    } catch (err) {} finally {
      setAddingIds(prev => { const next = new Set(prev); next.delete(track.id); return next; });
    }
  };

  if (loading) return (
    <div className="h-screen w-full bg-[#0a0a0a] flex flex-col items-center justify-center gap-6">
      <div className="relative">
        <Loader2 className="animate-spin text-brand-accent" size={48} />
        <div className="absolute inset-0 blur-xl bg-brand-accent/20 animate-pulse" />
      </div>
      <div className="label-caps animate-pulse">Establishing Secure Connection</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-mesh text-white selection:bg-brand-accent/30 selection:text-brand-accent overflow-hidden flex flex-col">
      {/* Dynamic Ambient Background Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
         <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-accent/5 blur-[120px] rounded-full animate-pulse-glow" />
         <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-brand-accent/10 blur-[100px] rounded-full animate-pulse-glow" style={{ animationDelay: '2s' }} />
      </div>

      <header className="fixed top-0 left-0 right-0 h-16 border-b border-brand-border bg-brand-dark/80 backdrop-blur-md z-50 px-6 flex items-center justify-between">
        <div className="flex items-center gap-3 group">
          <div className="w-10 h-10 glass-card flex items-center justify-center group-hover:border-brand-accent transition-colors">
            <Zap className="text-brand-accent" size={20} fill="currentColor" />
          </div>
          <div className="flex flex-col">
            <span className="font-black text-xs uppercase tracking-widest">{import.meta.env.VITE_APP_NAME || 'AH MUSIC'}</span>
            <span className="text-[10px] text-brand-text-dim font-mono tracking-tighter">NETWORK-ACTIVE // v4.0</span>
          </div>
        </div>

        <div className="flex-1 max-w-xl mx-12 hidden md:block">
          <form onSubmit={handleSearch} className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text-dim group-focus-within:text-brand-accent transition-colors" size={16} />
            <input 
              type="text" 
              placeholder="Search artists, songs or playlists..." 
              className="w-full input-mint pl-12 pr-12"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isSearching && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-brand-accent" size={16} />}
          </form>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden lg:flex flex-col items-end">
             <div className="label-caps mb-0 text-white leading-none">{auth?.user?.username || 'GUEST'}</div>
             <div className="text-[9px] text-brand-accent font-mono uppercase tracking-[0.2em]">{voiceChannel}</div>
          </div>
          <div className="w-10 h-10 rounded-full glass-card flex items-center justify-center overflow-hidden border-brand-accent/20">
             <User size={20} className="text-brand-text-dim" />
          </div>
        </div>
      </header>

      <main className="flex-1 mt-16 px-6 py-6 lg:grid lg:grid-cols-12 gap-6 max-h-[calc(100vh-4rem)] overflow-hidden relative z-10">
        
        {/* LEFT COLUMN: PLAYER & LYRICS */}
        <div className="lg:col-span-8 flex flex-col gap-6 overflow-hidden">
          
          {/* MAIN PLAYER BOX */}
          <div className="glass-card p-8 flex flex-col md:flex-row gap-8 relative overflow-hidden group">
            {/* Background Image Effect (Subtle) */}
            {currentTrack && (
              <div className="absolute inset-0 blur-3xl opacity-10 pointer-events-none group-hover:opacity-20 transition-opacity">
                <img src={getProxyUrl(currentTrack.thumbnail)} alt="" className="w-full h-full object-cover" />
              </div>
            )}

            {currentTrack ? (
              <>
                <div className="w-full md:w-64 flex-shrink-0">
                  <div className="relative aspect-square rounded-2xl overflow-hidden shadow-2xl border border-white/5">
                    <img src={getProxyUrl(currentTrack.thumbnail)} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/60 via-transparent to-transparent" />
                    <div className="absolute bottom-4 left-4 flex gap-1">
                      {[...Array(6)].map((_, i) => <div key={i} className="visual-bar" style={{ animationDelay: `${i*0.1}s` }} />)}
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0">
                  <div className="label-caps mb-4">Now Capturing Signal</div>
                  <h1 className="text-4xl lg:text-5xl font-black tracking-tight mb-2 truncate leading-tight">
                    {currentTrack.title}
                  </h1>
                  <p className="text-brand-accent font-medium mb-8">
                    {currentTrack.author}
                  </p>

                  <div className="flex flex-col gap-2 mb-8">
                    <input 
                      type="range"
                      min="0"
                      max={currentTrack.totalDurationMs || currentTrack.duration || 100}
                      value={currentTime}
                      onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[11px] font-mono text-brand-text-dim tracking-widest">
                       <span>{formatTime(currentTime)}</span>
                       <span>{formatTime(currentTrack.totalDurationMs || currentTrack.duration || 0)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <button onClick={() => handleControl(isPlaying ? 'pause' : 'resume')} className="btn-mint w-14 h-14 flex items-center justify-center p-0">
                      {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
                    </button>
                    <button onClick={() => handleControl('skip')} className="w-12 h-12 glass-card hover:border-brand-accent/50 transition-colors flex items-center justify-center">
                      <SkipForward size={22} />
                    </button>
                    <button 
                      onClick={() => currentTrack.actualUrl && discordSdkRef.current?.commands.openExternalLink({ url: currentTrack.actualUrl })}
                      className="w-12 h-12 glass-card hover:border-brand-accent/50 transition-colors flex items-center justify-center"
                    >
                      <ExternalLink size={18} />
                    </button>
                    <button onClick={() => handleControl('clear')} className="w-12 h-12 glass-card hover:border-red-500/50 hover:text-red-500 transition-colors flex items-center justify-center">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-64 flex flex-col items-center justify-center gap-4 opacity-50">
                <Music size={48} className="text-brand-text-dim" strokeWidth={1} />
                <div className="label-caps">Frequency Scanning...</div>
              </div>
            )}
          </div>

          {/* LYRICS ISLE */}
          <div className="flex-1 glass-card overflow-hidden flex flex-col">
            <div className="p-4 border-b border-brand-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen size={14} className="text-brand-accent" />
                <span className="label-caps mb-0">Synced Transmissions</span>
              </div>
              <div className="flex items-center gap-2">
                 <button onClick={() => axios.post(`${API_BASE}/api/sync/${auth.guild_id}`, { offset: -500 })} className="p-1 glass-card hover:border-brand-accent transition-colors"><ChevronLeft size={16} /></button>
                 <span className="text-[10px] font-mono text-brand-accent font-bold w-12 text-center">{lyricOffsetMs}ms</span>
                 <button onClick={() => axios.post(`${API_BASE}/api/sync/${auth.guild_id}`, { offset: 500 })} className="p-1 glass-card hover:border-brand-accent transition-colors"><ChevronRight size={16} /></button>
                 <button onClick={() => axios.post(`${API_BASE}/api/source/${auth.guild_id}`)} className="ml-2 px-3 py-1 glass-card text-[10px] uppercase font-black hover:border-brand-accent transition-colors">Rotate</button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 no-scrollbar scroll-smooth" onWheel={() => setIsAutoScrollPaused(true)}>
              {isLyricsLoading ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-brand-accent" /></div>
              ) : lyrics.length > 0 ? (
                <div className="flex flex-col gap-6">
                  {lyrics.map((line, idx) => (
                    <div 
                      key={idx} 
                      ref={idx === activeLyricIndex ? activeLyricRef : null}
                      className={`text-2xl lg:text-3xl font-black transition-all duration-500 ${idx === activeLyricIndex ? 'text-white translate-x-2' : 'text-white/10 blur-[1px]'}`}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center opacity-20 italic">No signal captured for this transmission.</div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: QUEUE & DISCOVERY */}
        <div className="lg:col-span-4 flex flex-col gap-6 overflow-hidden">
          
          {/* QUEUE */}
          <div className="flex-[0.4] glass-card flex flex-col overflow-hidden">
            <div className="p-4 border-b border-brand-border flex items-center gap-2">
              <ListMusic size={16} className="text-brand-accent" />
              <span className="label-caps mb-0">Up Next // Queue</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              <AnimatePresence>
                {queue.length > 1 ? queue.slice(1).map((track, idx) => (
                   <motion.div 
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                    key={`${track.id}-${idx}`}
                    className="group glass-card p-3 flex items-center gap-3 hover:border-brand-accent/50 transition-colors"
                   >
                     <img src={getProxyUrl(track.thumbnail)} className="w-10 h-10 rounded-lg object-cover" alt="" />
                     <div className="flex-1 min-w-0">
                       <div className="text-xs font-bold truncate">{track.title}</div>
                       <div className="text-[10px] text-brand-text-dim truncate">{track.author}</div>
                     </div>
                     <button onClick={() => handleControl('skip')} className="opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all">
                       <Trash2 size={14} />
                     </button>
                   </motion.div>
                )) : (
                  <div className="h-full flex items-center justify-center text-[10px] uppercase tracking-widest text-brand-text-dim">Queue is Empty</div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* DISCOVERY */}
          <div className="flex-[0.6] glass-card flex flex-col overflow-hidden">
            <div className="p-4 border-b border-brand-border flex items-center gap-2">
              <Globe size={16} className="text-brand-accent" />
              <span className="label-caps mb-0">Deep Space Discovery</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <AnimatePresence>
                {searchResults.map((t) => (
                   <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    key={t.id}
                    className="glass-card p-3 flex items-center gap-4 hover:border-brand-accent group overflow-hidden relative"
                   >
                     <img src={getProxyUrl(t.thumbnail)} className="w-12 h-12 rounded-xl object-cover z-10" alt="" />
                     <div className="flex-1 min-w-0 z-10">
                       <div className="text-xs font-black truncate group-hover:text-brand-accent transition-colors">{t.title}</div>
                       <div className="text-[10px] text-brand-text-dim truncate">{t.author}</div>
                     </div>
                     <button 
                       onClick={() => handleAdd(t)}
                       disabled={addingIds.has(t.id)}
                       className="w-8 h-8 rounded-lg bg-brand-accent/10 text-brand-accent flex items-center justify-center hover:bg-brand-accent hover:text-brand-dark transition-all z-10"
                     >
                       {addingIds.has(t.id) ? <Loader2 size={14} className="animate-spin" /> : <Plus size={16} />}
                     </button>
                     <div className="absolute inset-0 bg-brand-accent/5 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                   </motion.div>
                ))}
              </AnimatePresence>
              {!isSearching && searchResults.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center gap-4 opacity-30 text-center p-12">
                   <Search size={32} strokeWidth={1} />
                   <p className="text-xs">Transmit a query to explore the global music network.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* TOAST NOTIFICATION */}
      <AnimatePresence>
        {lastAdded && (
          <motion.div 
            initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: -20 }} exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-0 left-1/2 -translate-x-1/2 px-6 py-3 bg-brand-accent text-brand-dark font-black rounded-xl shadow-[0_0_50px_rgba(0,255,191,0.5)] z-[100] flex items-center gap-3"
          >
            <Zap size={18} fill="currentColor" />
            <span className="text-xs tracking-tight">QUEUED: {lastAdded.substring(0, 32)}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
