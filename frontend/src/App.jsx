import { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, Search, Plus, Loader2, ListMusic, Music, Globe, User, BookOpen, Trash2, Rewind, FastForward, ExternalLink, ChevronLeft, ChevronRight, Zap, X } from 'lucide-react';
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
  const lyricsContainerRef = useRef(null);
  const activeLyricRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingIds, setAddingIds] = useState(new Set());
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [lastAdded, setLastAdded] = useState(null);
  const [currentTrackTitle, setCurrentTrackTitle] = useState("");
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

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
    if (idx !== -1 && idx !== activeLyricIndex) {
      setActiveLyricIndex(idx);
    }
  }, [currentTime, lyrics, lyricOffsetMs]);

  // Center active lyric in view
  useEffect(() => {
    if (activeLyricRef.current && !isAutoScrollPaused && lyricsContainerRef.current) {
        const activeLine = activeLyricRef.current;
        const container = lyricsContainerRef.current;
        const top = activeLine.offsetTop - (container.offsetHeight / 2) + (activeLine.offsetHeight / 2);
        container.scrollTo({ top, behavior: 'smooth' });
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
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const resp = await axios.get(`${API_BASE}/api/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(resp.data);
      if (isMobileSearchOpen) setIsMobileSearchOpen(false);
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

  const handleSync = async (offset) => {
      const guildId = auth?.guild_id || new URLSearchParams(window.location.search).get('guild_id');
      await axios.post(`${API_BASE}/api/sync/${guildId}`, { offset });
      fetchQueue(guildId);
  }

  if (loading) return (
    <div className="h-screen w-full bg-[#0a0a0a] flex flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="relative scale-125">
        <Loader2 className="animate-spin text-brand-accent" size={56} />
        <div className="absolute inset-0 blur-xl bg-brand-accent/20 animate-pulse" />
      </div>
      <div className="label-caps animate-pulse text-lg">Initializing Neural Stream</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-mesh text-white selection:bg-brand-accent/30 selection:text-brand-accent overflow-x-hidden flex flex-col">
      {/* Dynamic Ambient Background Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
         <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] lg:w-[40%] lg:h-[40%] bg-brand-accent/5 blur-[120px] rounded-full animate-pulse-glow" />
         <div className="absolute bottom-[-5%] right-[-5%] w-[50%] h-[50%] lg:w-[30%] lg:h-[30%] bg-brand-accent/10 blur-[100px] rounded-full animate-pulse-glow" style={{ animationDelay: '2s' }} />
      </div>

      <header className="fixed top-0 left-0 right-0 h-16 border-b border-brand-border bg-brand-dark/80 backdrop-blur-lg z-50 px-4 lg:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3 group shrink-0">
          <div className="w-10 h-10 glass-card flex items-center justify-center group-hover:border-brand-accent transition-all duration-500 hover:shadow-neon">
            <Zap className="text-brand-accent" size={20} fill="currentColor" />
          </div>
          <div className="flex flex-col">
            <span className="font-black text-xs lg:text-sm uppercase tracking-widest leading-none mb-0.5">{import.meta.env.VITE_APP_NAME || 'AH MUSIC'}</span>
            <span className="text-[10px] text-brand-text-dim font-mono tracking-tighter">V4.4 // STABLE_READY</span>
          </div>
        </div>

        <div className="flex-1 max-w-xl mx-4 lg:mx-12 hidden md:block">
          <form onSubmit={handleSearch} className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text-dim group-focus-within:text-brand-accent transition-colors" size={18} />
            <input 
              type="text" 
              placeholder="Search artists, songs or playlists..." 
              className="w-full input-mint pl-12 pr-12 h-11"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isSearching && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-brand-accent" size={18} />}
          </form>
        </div>

        <div className="flex items-center gap-3 lg:gap-6 shrink-0">
          <button 
            onClick={() => setIsMobileSearchOpen(true)}
            className="md:hidden w-10 h-10 glass-card flex items-center justify-center text-brand-text-dim hover:text-brand-accent"
          >
            <Search size={20} />
          </button>

          <div className="hidden sm:flex flex-col items-end">
             <div className="label-caps mb-0 text-white leading-none text-[10px] lg:text-[11px]">{auth?.user?.username || 'GUEST'}</div>
             <div className="text-[9px] text-brand-accent font-mono uppercase tracking-[0.2em] truncate max-w-[100px]">{voiceChannel}</div>
          </div>
          <div className="w-10 h-10 rounded-full glass-card flex items-center justify-center overflow-hidden border-brand-accent/20">
             <User size={20} className="text-brand-text-dim" />
          </div>
        </div>
      </header>

      {/* MOBILE SEARCH OVERLAY */}
      <AnimatePresence>
        {isMobileSearchOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 bg-brand-dark/98 backdrop-blur-2xl z-[100] p-6 md:hidden"
          >
            <div className="flex items-center justify-between mb-8">
               <div className="label-caps mb-0 text-lg">Signal Broadcaster</div>
               <button onClick={() => setIsMobileSearchOpen(false)} className="text-brand-text-dim p-2 hover:text-white transition-colors"><X size={28} /></button>
            </div>
            <form onSubmit={handleSearch} className="relative mb-10">
               <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-accent" size={24} />
               <input 
                  autoFocus
                  type="text" 
                  placeholder="Enter transmission query..." 
                  className="w-full input-mint pl-14 h-16 text-xl"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
               />
            </form>
            <div className="label-caps mb-4 opacity-50">Saved Network Hubs</div>
            <div className="flex flex-wrap gap-3">
               {['Sukoon Beats', 'Deep House', 'Hardstyle', 'LoFi Hip-Hop'].map(t => (
                 <button key={t} onClick={() => { setSearchQuery(t); handleSearch(); }} className="px-5 py-3 glass-card text-xs font-black uppercase hover:border-brand-accent transition-all active:scale-95">{t}</button>
               ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 mt-16 px-4 lg:px-6 py-4 lg:py-6 lg:grid lg:grid-cols-12 gap-6 relative z-10 w-full pb-32">
        
        {/* LEFT COLUMN: PLAYER & LYRICS */}
        <div className="flex flex-col gap-6 lg:col-span-8 lg:max-h-[calc(100vh-4rem)] lg:overflow-hidden min-w-0">
          
          {/* PLAYER CARD */}
          <div className="glass-card p-6 lg:p-10 flex flex-col sm:flex-row gap-8 lg:gap-12 relative overflow-hidden group shrink-0 h-auto sm:h-[400px] lg:h-auto">
            {currentTrack && (
              <div className="absolute inset-0 blur-3xl opacity-10 pointer-events-none group-hover:opacity-15 transition-opacity">
                <img src={getProxyUrl(currentTrack.thumbnail)} alt="" className="w-full h-full object-cover" />
              </div>
            )}

            {currentTrack ? (
              <>
                <div className="w-full sm:w-64 lg:w-80 flex-shrink-0">
                  <div className="relative aspect-square rounded-[2rem] overflow-hidden shadow-2xl border border-white/5 mx-auto sm:mx-0 max-w-[300px] sm:max-w-none hover:scale-[1.02] transition-transform duration-500">
                    <img src={getProxyUrl(currentTrack.thumbnail)} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/70 via-transparent to-transparent opacity-60" />
                    <div className="absolute bottom-6 left-6 flex gap-1.5 items-end h-8">
                      {[...Array(10)].map((_, i) => <div key={i} className="visual-bar w-[4px]" style={{ animationDelay: `${i*0.1}s` }} />)}
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0 text-center sm:text-left">
                  <div className="label-caps mb-4 text-brand-accent/70 tracking-[0.3em]">Signal Output // High Fidelity</div>
                  <h1 className="text-3xl sm:text-4xl lg:text-7xl font-black tracking-tight mb-2 truncate leading-none overflow-hidden text-ellipsis whitespace-nowrap">
                    {currentTrack.title}
                  </h1>
                  <p className="text-brand-accent text-xl lg:text-2xl font-bold mb-8 lg:mb-14 truncate opacity-90 tracking-tight">
                    {currentTrack.author}
                  </p>

                  <div className="flex flex-col gap-4 mb-10 lg:mb-12">
                    <input 
                      type="range"
                      min="0"
                      max={currentTrack.totalDurationMs || currentTrack.duration || 100}
                      value={currentTime}
                      onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
                      className="w-full accent-brand-accent cursor-pointer h-3"
                    />
                    <div className="flex justify-between text-xs font-mono text-brand-text-dim tracking-widest font-black">
                       <span>{formatTime(currentTime)}</span>
                       <span>{formatTime(currentTrack.totalDurationMs || currentTrack.duration || 0)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-center sm:justify-start gap-4 lg:gap-8">
                    <button 
                      onClick={() => handleControl(isPlaying ? 'pause' : 'resume')} 
                      className="btn-mint w-20 h-20 lg:w-28 lg:h-28 flex items-center justify-center p-0 rounded-3xl lg:rounded-[2.5rem] shadow-neon-strong active:scale-95 transition-all"
                    >
                      {isPlaying ? <Pause size={40} lg:size={56} fill="currentColor" /> : <Play size={40} lg:size={56} fill="currentColor" className="ml-1.5" />}
                    </button>
                    <button onClick={() => handleControl('skip')} className="w-14 h-14 lg:w-20 lg:h-20 glass-card hover:border-brand-accent/50 hover:bg-brand-accent/5 transition-all flex items-center justify-center rounded-2xl lg:rounded-3xl active:scale-90">
                      <SkipForward size={28} lg:size={40} />
                    </button>
                    <button 
                      onClick={() => currentTrack.actualUrl && discordSdkRef.current?.commands.openExternalLink({ url: currentTrack.actualUrl })}
                      className="hidden sm:flex w-14 h-14 lg:w-20 lg:h-20 glass-card hover:border-brand-accent/50 hover:bg-brand-accent/5 transition-all items-center justify-center rounded-2xl lg:rounded-3xl active:scale-90"
                    >
                      <ExternalLink size={24} lg:size={32} />
                    </button>
                    <button onClick={() => handleControl('clear')} className="w-14 h-14 lg:w-20 lg:h-20 glass-card hover:border-red-500/50 hover:text-red-500 hover:bg-red-500/5 transition-all flex items-center justify-center rounded-2xl lg:rounded-3xl active:scale-90">
                      <Trash2 size={24} lg:size={32} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-80 lg:h-[500px] flex flex-col items-center justify-center gap-8 opacity-20">
                <Music size={80} className="text-brand-text-dim animate-pulse" strokeWidth={1} />
                <div className="label-caps text-xl sm:text-2xl tracking-[0.5em]">Network Standby</div>
              </div>
            )}
          </div>

          {/* LYRICS PANEL */}
          <div className="flex-1 glass-card overflow-hidden flex flex-col min-h-[500px] lg:min-h-0 border-brand-accent/10">
            <div className="p-5 lg:p-6 border-b border-brand-border flex items-center justify-between bg-white/[0.04]">
              <div className="flex items-center gap-4">
                <BookOpen size={20} className="text-brand-accent" />
                <span className="label-caps mb-0 text-xs lg:text-sm">Neural Subtitles</span>
              </div>
              <div className="flex items-center gap-4">
                 <div className="flex items-center glass-card p-1 rounded-xl">
                    <button onClick={() => handleSync(-500)} className="p-2 px-3 hover:text-brand-accent transition-colors"><ChevronLeft size={20} /></button>
                    <span className="text-xs font-mono text-brand-accent font-black w-16 text-center">{lyricOffsetMs}ms</span>
                    <button onClick={() => handleSync(500)} className="p-2 px-3 hover:text-brand-accent transition-colors"><ChevronRight size={20} /></button>
                 </div>
                 <button onClick={() => axios.post(`${API_BASE}/api/source/${auth.guild_id}`)} className="px-6 py-3 glass-card text-xs font-black hover:border-brand-accent hover:shadow-neon transition-all uppercase tracking-widest active:scale-95">Source Rotate</button>
              </div>
            </div>
            
            <div 
              className="flex-1 overflow-y-auto p-10 lg:p-16 no-scrollbar scroll-smooth relative" 
              ref={lyricsContainerRef}
              onWheel={() => setIsAutoScrollPaused(true)}
              onTouchStart={() => setIsAutoScrollPaused(true)}
            >
              {isLyricsLoading ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-brand-accent" size={48} /></div>
              ) : lyrics.length > 0 ? (
                <div className="flex flex-col gap-10 lg:gap-16 pb-48 pt-48">
                  {lyrics.map((line, idx) => {
                    const isActive = idx === activeLyricIndex;
                    return (
                      <div 
                        key={idx} 
                        ref={isActive ? activeLyricRef : null}
                        className={`text-3xl sm:text-4xl lg:text-6xl font-black transition-all duration-700 transform ${isActive ? 'text-white translate-x-4 scale-110 opacity-100' : 'text-white/5 blur-[3px] scale-95 hover:text-white/20 hover:blur-0 pointer-events-auto'}`}
                      >
                        {line.text}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center opacity-10 gap-6">
                   <Music size={64} strokeWidth={1} />
                   <div className="text-lg font-black uppercase tracking-[0.5em]">No Active Subtitles</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: QUEUES & SEARCH - Scrolls only on desktop */}
        <div className="lg:col-span-4 flex flex-col gap-6 lg:max-h-[calc(100vh-4rem)] lg:overflow-hidden min-w-0">
          
          {/* QUEUE */}
          <div className="lg:flex-[0.45] glass-card flex flex-col overflow-hidden border-brand-accent/5">
            <div className="p-5 border-b border-brand-border flex items-center justify-between bg-white/[0.04]">
              <div className="flex items-center gap-3">
                <ListMusic size={20} className="text-brand-accent" />
                <span className="label-caps mb-0 text-sm">Signal Queue</span>
              </div>
              <span className="text-xs font-mono font-black text-brand-accent">{Math.max(0, queue.length - 1)} NODES</span>
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 no-scrollbar pb-12">
              <AnimatePresence>
                {queue.length > 1 ? queue.slice(1).map((track, idx) => (
                   <motion.div 
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                    key={`${track.id}-${idx}`}
                    className="group glass-card p-4 flex items-center gap-5 hover:border-brand-accent/50 bg-white/[0.02] transition-all hover:translate-x-1"
                   >
                     <img src={getProxyUrl(track.thumbnail)} className="w-14 h-14 rounded-2xl object-cover" alt="" />
                     <div className="flex-1 min-w-0">
                       <div className="text-[13px] font-black truncate leading-tight group-hover:text-brand-accent transition-colors uppercase tracking-tight">{track.title}</div>
                       <div className="text-[11px] text-brand-text-dim truncate font-bold uppercase tracking-tighter opacity-70 mt-1">{track.author}</div>
                     </div>
                     <button onClick={() => handleControl('skip')} className="lg:opacity-0 group-hover:opacity-100 hover:text-white transition-all p-3 bg-red-500/20 rounded-xl hover:bg-red-500/40">
                       <Trash2 size={18} />
                     </button>
                   </motion.div>
                )) : (
                  <div className="h-full flex flex-col items-center justify-center opacity-10 py-16">
                     <div className="label-caps tracking-[0.4em]">Queue Empty</div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* DISCOVERY */}
          <div className="lg:flex-[0.55] glass-card flex flex-col overflow-hidden border-brand-accent/5 bg-white/[0.01]">
            <div className="p-5 border-b border-brand-border flex items-center justify-between bg-white/[0.04]">
              <div className="flex items-center gap-3">
                <Globe size={20} className="text-brand-accent" />
                <span className="label-caps mb-0 text-sm">Deep Space Discovery</span>
              </div>
              {searchResults.length > 0 && <button onClick={() => setSearchResults([])} className="p-2 px-4 glass-card text-[10px] font-black text-red-500 hover:bg-red-500/10 active:scale-95 transition-all">TERMINATE</button>}
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 no-scrollbar pb-12">
              <AnimatePresence>
                {searchResults.map((t) => (
                   <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    key={t.id}
                    className="glass-card p-4 flex items-center gap-5 hover:border-brand-accent group overflow-hidden relative transition-all active:scale-[0.98]"
                   >
                     <img src={getProxyUrl(t.thumbnail)} className="w-16 h-16 rounded-[1.25rem] object-cover z-10" alt="" />
                     <div className="flex-1 min-w-0 z-10">
                       <div className="text-sm font-black truncate group-hover:text-brand-accent transition-colors uppercase tracking-tight">{t.title}</div>
                       <div className="text-xs text-brand-text-dim truncate font-bold opacity-60 mt-1">{t.author}</div>
                     </div>
                     <button 
                       onClick={() => handleAdd(t)}
                       disabled={addingIds.has(t.id)}
                       className="w-12 h-12 rounded-2xl bg-brand-accent/10 text-brand-accent flex items-center justify-center hover:bg-brand-accent hover:text-brand-dark transition-all z-10 shadow-xl border border-brand-accent/20"
                     >
                       {addingIds.has(t.id) ? <Loader2 size={20} className="animate-spin" /> : <Plus size={24} />}
                     </button>
                     <div className="absolute inset-0 bg-brand-accent/[0.05] translate-y-full group-hover:translate-y-0 transition-transform duration-700" />
                   </motion.div>
                ))}
              </AnimatePresence>
              {!isSearching && searchResults.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center gap-10 opacity-10 text-center p-12">
                   <div className="relative scale-150">
                      <Search size={48} strokeWidth={1} />
                      <div className="absolute inset-0 blur-xl bg-brand-accent/30 animate-pulse" />
                   </div>
                   <p className="text-xs font-black uppercase tracking-[0.5em] leading-relaxed">Broadcast to <br/> Capture Content</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* GLOBAL TOAST DOCK */}
      <AnimatePresence>
        {lastAdded && (
          <motion.div 
            initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: -40 }} exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-0 left-1/2 -translate-x-1/2 px-8 py-5 bg-brand-accent text-brand-dark font-black rounded-3xl shadow-neon-strong z-[200] flex items-center gap-6 whitespace-nowrap overflow-hidden max-w-[95%] border-t-[3px] border-white/20"
          >
            <Zap size={28} fill="currentColor" />
            <div className="flex flex-col">
               <span className="text-[10px] uppercase tracking-[0.3em] opacity-80 leading-none mb-1.5 font-bold">Node Initialized</span>
               <span className="text-sm lg:text-lg tracking-tight truncate leading-none uppercase">{lastAdded}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
