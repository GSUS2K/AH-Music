import { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, Search, Plus, Loader2, ListMusic, Music, Globe, User, BookOpen, Trash2, Rewind, FastForward, ExternalLink, ChevronLeft, ChevronRight, Zap, X, Cpu, HardDrive } from 'lucide-react';
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

  const handleRemove = async (index) => {
    const guildId = auth?.guild_id || new URLSearchParams(window.location.search).get('guild_id');
    try { await axios.post(`${API_BASE}/api/remove/${guildId}/${index}`); fetchQueue(guildId); } catch (err) {}
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
      {/* Background Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
         <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] lg:w-[40%] lg:h-[40%] bg-brand-accent/5 blur-[120px] rounded-full animate-pulse-glow" />
         <div className="absolute bottom-[-5%] right-[-5%] w-[50%] h-[50%] lg:w-[30%] lg:h-[30%] bg-brand-accent/10 blur-[100px] rounded-full animate-pulse-glow" style={{ animationDelay: '2s' }} />
      </div>

      <header className="fixed top-0 left-0 right-0 h-16 border-b border-brand-border bg-brand-dark/90 backdrop-blur-xl z-50 px-4 lg:px-8 flex items-center gap-4 lg:gap-12">
        {/* LOGO COLUMN */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 glass-card flex items-center justify-center group-hover:border-brand-accent transition-all duration-500 hover:shadow-neon">
            <Zap className="text-brand-accent" size={20} fill="currentColor" />
          </div>
          <div className="hidden lg:flex flex-col">
            <span className="font-black text-xs uppercase tracking-widest leading-none mb-0.5">{import.meta.env.VITE_APP_NAME || 'AH MUSIC'}</span>
            <span className="text-[10px] text-brand-text-dim font-mono tracking-tighter uppercase whitespace-nowrap">Neural-Ready // V4.5</span>
          </div>
        </div>

        {/* SEARCH COLUMN (CENTER) */}
        <div className="flex-1 max-w-2xl hidden md:block">
          <form onSubmit={handleSearch} className="relative group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text-dim group-focus-within:text-brand-accent z-10">
              <Search size={18} />
            </div>
            <input 
              type="text" 
              placeholder="Broadcasting search signals..." 
              className="w-full input-mint pl-14 pr-12 h-11 bg-white/5 border-white/10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isSearching && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-brand-accent" size={18} />}
          </form>
        </div>

        {/* STATS & USER COLUMN (RIGHT) */}
        <div className="flex items-center gap-4 lg:gap-8 shrink-0 ml-auto">
          {/* Neural Flux Meter (CPU/RAM) */}
          <div className="hidden xl:flex items-center gap-6 border-l border-white/10 h-10 pl-8">
             <div className="flex flex-col items-end">
                <div className="flex items-center gap-2 label-caps mb-0 text-[10px] whitespace-nowrap"><Cpu size={10} className="text-brand-accent" /> SYNAPSE LOAD</div>
                <div className="font-mono text-[11px] font-black text-brand-accent">{systemStats?.cpu || '0%'}</div>
             </div>
             <div className="flex flex-col items-end">
                <div className="flex items-center gap-2 label-caps mb-0 text-[10px] whitespace-nowrap"><HardDrive size={10} className="text-brand-accent" /> MEM_ALLOC</div>
                <div className="font-mono text-[11px] font-black text-brand-accent">{systemStats?.mem || '0%'}</div>
             </div>
          </div>

          <button onClick={() => setIsMobileSearchOpen(true)} className="md:hidden w-10 h-10 glass-card flex items-center justify-center text-brand-text-dim"><Search size={20} /></button>

          <div className="flex items-center gap-3">
             <div className="hidden md:flex flex-col items-end">
                <div className="label-caps mb-0 text-white leading-none text-[11px] truncate max-w-[120px]">{auth?.user?.username || 'GUEST'}</div>
                <div className="text-[9px] text-brand-accent font-mono uppercase tracking-[0.2em] truncate max-w-[100px]">{voiceChannel}</div>
             </div>
             <div className="w-10 h-10 rounded-full glass-card flex items-center justify-center p-0.5 border-brand-accent/20 overflow-hidden shrink-0">
               <User size={22} className="text-brand-text-dim" />
             </div>
          </div>
        </div>
      </header>

      {/* Mobile Search Overlay */}
      <AnimatePresence>
        {isMobileSearchOpen && (
          <motion.div 
            initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }}
            className="fixed inset-0 bg-brand-dark/98 backdrop-blur-3xl z-[100] p-6 flex flex-col md:hidden"
          >
            <div className="flex items-center justify-between mb-8">
               <div className="label-caps mb-0 text-lg">Query Broadcast</div>
               <button onClick={() => setIsMobileSearchOpen(false)} className="text-brand-text-dim p-2"><X size={32} /></button>
            </div>
            <form onSubmit={handleSearch} className="relative mb-8">
               <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-brand-accent" size={28} />
               <input autoFocus type="text" placeholder="Scanning..." className="w-full bg-white/5 border border-white/10 rounded-2xl pl-16 h-20 text-2xl font-black outline-none focus:border-brand-accent transition-all" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </form>
            <div className="label-caps opacity-30 mb-4 tracking-[0.5em]">Common Signals</div>
            <div className="flex flex-wrap gap-4">
               {['Sukoon', 'Bollywood', 'LoFi', 'Phonk'].map(t => (
                 <button key={t} onClick={() => { setSearchQuery(t); handleSearch(); }} className="px-6 py-3 glass-card text-xs font-black uppercase hover:border-brand-accent">{t}</button>
               ))}
            </div>
            <div className="mt-auto label-caps text-brand-accent/30 text-center">Transmission ID: {Math.random().toString(36).substring(7).toUpperCase()}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 mt-16 px-4 lg:px-8 py-6 lg:grid lg:grid-cols-12 gap-8 relative z-10 w-full pb-32 overflow-x-hidden">
        
        {/* LEFT COMPONENT */}
        <div className="flex flex-col gap-8 lg:col-span-8 lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden min-w-0">
          
          {/* MASTER PLAYER */}
          <div className="glass-card p-6 lg:p-12 flex flex-col sm:flex-row gap-10 lg:gap-14 relative overflow-hidden group shrink-0 shadow-[0_0_100px_rgba(0,0,0,0.5)]">
            {currentTrack && (
              <div className="absolute inset-0 blur-3xl opacity-10 pointer-events-none group-hover:opacity-15 transition-opacity">
                <img src={getProxyUrl(currentTrack.thumbnail)} alt="" className="w-full h-full object-cover" />
              </div>
            )}

            {currentTrack ? (
              <>
                <div className="w-full sm:w-72 lg:w-96 flex-shrink-0">
                  <div className="relative aspect-square rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/5 mx-auto sm:mx-0 max-w-[320px] sm:max-w-none hover:scale-[1.03] transition-all duration-700">
                    <img src={getProxyUrl(currentTrack.thumbnail)} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/80 via-transparent to-transparent opacity-70" />
                    <div className="absolute bottom-8 left-8 flex gap-2 items-end h-12">
                      {[...Array(12)].map((_, i) => <div key={i} className="visual-bar w-[5px]" style={{ animationDelay: `${i*0.1}s` }} />)}
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0 text-center sm:text-left pt-4 sm:pt-0">
                  <div className="label-caps mb-4 text-brand-accent/50 tracking-[0.4em]">Propagating Signal Stream</div>
                  <h1 className="text-3xl sm:text-4xl lg:text-7xl font-black tracking-tight mb-2 truncate leading-tight overflow-hidden text-ellipsis whitespace-nowrap">
                    {currentTrack.title}
                  </h1>
                  <p className="text-brand-accent text-xl lg:text-3xl font-black mb-10 lg:mb-16 truncate opacity-90 tracking-tighter">
                    {currentTrack.author}
                  </p>

                  <div className="flex flex-col gap-4 mb-12 lg:mb-14">
                    <input type="range" min="0" max={currentTrack.totalDurationMs || currentTrack.duration || 100} value={currentTime} onChange={(e) => setCurrentTime(parseFloat(e.target.value))} className="w-full accent-brand-accent cursor-pointer h-3 rounded-full" />
                    <div className="flex justify-between text-xs lg:text-sm font-mono text-brand-text-dim tracking-widest font-black">
                       <span>{formatTime(currentTime)}</span>
                       <span className="text-brand-accent opacity-50">{formatTime(currentTrack.totalDurationMs || currentTrack.duration || 0)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-center sm:justify-start gap-5 lg:gap-10">
                    <button onClick={() => handleControl(isPlaying ? 'pause' : 'resume')} className="btn-mint w-24 h-24 lg:w-32 lg:h-32 flex items-center justify-center p-0 rounded-[2.5rem] lg:rounded-[3rem] shadow-neon-strong active:scale-95 transition-all">
                      {isPlaying ? <Pause size={48} lg:size={64} fill="currentColor" /> : <Play size={48} lg:size={64} fill="currentColor" className="ml-2" />}
                    </button>
                    <button onClick={() => handleControl('skip')} className="w-16 h-16 lg:w-20 lg:h-20 glass-card hover:border-brand-accent/50 hover:bg-brand-accent/5 transition-all flex items-center justify-center rounded-3xl active:scale-90">
                      <SkipForward size={32} lg:size={40} />
                    </button>
                    <button onClick={() => handleControl('clear')} className="w-16 h-16 lg:w-20 lg:h-20 glass-card hover:border-red-500 hover:text-red-500 hover:bg-red-500/10 transition-all flex items-center justify-center rounded-3xl active:scale-90">
                      <Trash2 size={28} lg:size={36} />
                    </button>
                    <button onClick={() => currentTrack.actualUrl && discordSdkRef.current?.commands.openExternalLink({ url: currentTrack.actualUrl })} className="hidden sm:flex w-16 h-16 lg:w-20 lg:h-20 glass-card hover:border-brand-accent/50 hover:bg-brand-accent/5 transition-all items-center justify-center rounded-3xl active:scale-90">
                      <ExternalLink size={28} lg:size={36} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-80 lg:h-[600px] flex flex-col items-center justify-center gap-10 opacity-10">
                <Music size={120} className="text-brand-text-dim animate-pulse" strokeWidth={0.5} />
                <div className="label-caps text-3xl tracking-[0.8em]">Awaiting Data</div>
              </div>
            )}
          </div>

          {/* MASTER LYRICS */}
          <div className="flex-1 glass-card overflow-hidden flex flex-col min-h-[500px] lg:min-h-0 border-brand-accent/10 shadow-[0_40px_100px_rgba(0,0,0,0.3)]">
            <div className="p-6 lg:p-8 border-b border-brand-border flex items-center justify-between bg-white/[0.04]">
              <div className="flex items-center gap-4">
                <BookOpen size={24} className="text-brand-accent" />
                <span className="label-caps mb-0 text-sm lg:text-base tracking-[0.3em]">Neural Subtitles</span>
              </div>
              <div className="flex items-center gap-6">
                 <div className="flex items-center glass-card p-1.5 rounded-2xl bg-black/40">
                    <button onClick={() => handleSync(-500)} className="p-2 px-4 hover:text-brand-accent transition-colors"><ChevronLeft size={24} /></button>
                    <span className="text-sm font-mono text-brand-accent font-black w-24 text-center">{lyricOffsetMs}ms</span>
                    <button onClick={() => handleSync(500)} className="p-2 px-4 hover:text-brand-accent transition-colors"><ChevronRight size={24} /></button>
                 </div>
                 <button onClick={() => axios.post(`${API_BASE}/api/source/${auth.guild_id}`)} className="px-8 py-3.5 glass-card text-xs font-black hover:border-brand-accent hover:shadow-neon transition-all uppercase tracking-[0.2em] active:scale-95 bg-brand-accent/5">Rotate Hubs</button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-12 lg:p-24 no-scrollbar scroll-smooth relative" ref={lyricsContainerRef} onWheel={() => setIsAutoScrollPaused(true)} onTouchStart={() => setIsAutoScrollPaused(true)}>
              {isLyricsLoading ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-brand-accent" size={64} /></div>
              ) : lyrics.length > 0 ? (
                <div className="flex flex-col gap-12 lg:gap-20 pb-64 pt-64">
                  {lyrics.map((line, idx) => {
                    const isActive = idx === activeLyricIndex;
                    return (
                      <div key={idx} ref={isActive ? activeLyricRef : null} className={`text-3xl sm:text-5xl lg:text-7xl font-black transition-all duration-1000 transform leading-tight ${isActive ? 'text-white translate-x-6 scale-110 opacity-100' : 'text-white/[0.03] blur-[4px] scale-90 hover:text-white/20 hover:blur-0 pointer-events-auto'}`}>
                        {line.text}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center opacity-10 gap-8">
                   <Music size={100} strokeWidth={0.5} />
                   <div className="text-xl font-black uppercase tracking-[0.6em]">Signal Silent</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COMPONENTS */}
        <div className="lg:col-span-4 flex flex-col gap-8 lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden min-w-0">
          
          {/* QUEUE */}
          <div className="lg:flex-[0.4] glass-card flex flex-col overflow-hidden border-brand-accent/5 shadow-2xl">
            <div className="p-6 border-b border-brand-border flex items-center justify-between bg-white/[0.05]">
               <div className="flex items-center gap-3">
                 <ListMusic size={22} className="text-brand-accent" />
                 <span className="label-caps mb-0 text-sm">Signal Archive</span>
               </div>
               <span className="text-[10px] font-mono font-black text-brand-accent bg-brand-accent/10 px-3 py-1 rounded-full">{Math.max(0, queue.length - 1)} TRACKS</span>
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 no-scrollbar pb-16">
              <AnimatePresence>
                {queue.length > 1 ? queue.slice(1).map((track, idx) => (
                   <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} key={`${track.id}-${idx}`} className="group glass-card p-4 flex items-center gap-5 hover:border-brand-accent/50 bg-white/[0.02] transition-all hover:translate-x-1">
                     <img src={getProxyUrl(track.thumbnail)} className="w-16 h-16 rounded-2xl object-cover" alt="" />
                     <div className="flex-1 min-w-0">
                       <div className="text-[14px] font-black truncate leading-tight group-hover:text-brand-accent transition-colors uppercase tracking-tight">{track.title}</div>
                       <div className="text-[10px] text-brand-text-dim truncate font-bold uppercase opacity-60 mt-1.5">{track.author}</div>
                     </div>
                     <button onClick={() => handleRemove(idx + 1)} className="lg:opacity-0 group-hover:opacity-100 hover:text-white transition-all p-3 bg-red-500/10 rounded-xl hover:bg-red-500/40">
                       <Trash2 size={20} />
                     </button>
                   </motion.div>
                )) : (
                  <div className="h-full flex flex-col items-center justify-center opacity-10 py-24 italic text-sm text-center px-12 tracking-widest leading-loose uppercase font-black text-xs">Awaiting data injection to signal queue</div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* DISCOVERY */}
          <div className="lg:flex-[0.6] glass-card flex flex-col overflow-hidden border-brand-accent/5 bg-white/[0.01] shadow-2xl">
            <div className="p-6 border-b border-brand-border flex items-center justify-between bg-white/[0.05]">
              <div className="flex items-center gap-3">
                <Globe size={22} className="text-brand-accent" />
                <span className="label-caps mb-0 text-sm">Neural Discovery Hub</span>
              </div>
              {searchResults.length > 0 && <button onClick={() => setSearchResults([])} className="p-2 px-5 glass-card text-[10px] font-black text-red-500 hover:bg-red-500/10 active:scale-95 transition-all">FLUSH</button>}
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5 no-scrollbar pb-20">
              <AnimatePresence>
                {searchResults.map((t) => (
                   <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} key={t.id} className="glass-card p-5 flex items-center gap-6 hover:border-brand-accent group overflow-hidden relative transition-all active:scale-[0.98]">
                     <img src={getProxyUrl(t.thumbnail)} className="w-20 h-20 rounded-[1.5rem] object-cover z-10" alt="" />
                     <div className="flex-1 min-w-0 z-10">
                       <div className="text-[15px] font-black truncate group-hover:text-brand-accent transition-colors uppercase tracking-tight">{t.title}</div>
                       <div className="text-[11px] text-brand-text-dim truncate font-bold opacity-60 mt-2">{t.author}</div>
                     </div>
                     <button onClick={() => handleAdd(t)} disabled={addingIds.has(t.id)} className="w-14 h-14 rounded-2xl bg-brand-accent/10 text-brand-accent flex items-center justify-center hover:bg-brand-accent hover:text-brand-dark transition-all z-10 shadow-2xl border border-brand-accent/30 active:scale-90">
                       {addingIds.has(t.id) ? <Loader2 size={24} className="animate-spin" /> : <Plus size={28} />}
                     </button>
                     <div className="absolute inset-0 bg-brand-accent/[0.08] translate-y-full group-hover:translate-y-0 transition-transform duration-700" />
                   </motion.div>
                ))}
              </AnimatePresence>
              {!isSearching && searchResults.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center gap-12 opacity-10 text-center p-12">
                   <div className="relative scale-[2]">
                      <Search size={48} strokeWidth={0.5} />
                      <div className="absolute inset-0 blur-2xl bg-brand-accent/40 animate-pulse" />
                   </div>
                   <p className="text-xs font-black uppercase tracking-[0.6em] leading-loose">Transmit Query <br/> to Sync Network</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Neural Link Overlay (Toast) */}
      <AnimatePresence>
        {lastAdded && (
          <motion.div initial={{ opacity: 0, y: 150 }} animate={{ opacity: 1, y: -50 }} exit={{ opacity: 0, y: 150 }} className="fixed bottom-0 left-1/2 -translate-x-1/2 px-12 py-6 bg-brand-accent text-brand-dark font-black rounded-3xl shadow-[0_0_100px_rgba(0,255,191,0.6)] z-[200] flex items-center gap-8 whitespace-nowrap overflow-hidden max-w-[95%] border-t-[4px] border-white/30">
            <Zap size={36} fill="currentColor" />
            <div className="flex flex-col">
               <span className="text-[11px] uppercase tracking-[0.4em] opacity-80 leading-none mb-2 font-black">Memory Injected</span>
               <span className="text-lg lg:text-2xl tracking-tighter truncate leading-none uppercase">{lastAdded}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
