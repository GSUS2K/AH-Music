import { useState, useEffect, useRef, Component } from 'react';
import { Play, Pause, SkipForward, Search, Plus, Loader2, ListMusic, Music, Globe, User, BookOpen, Trash2, Rewind, FastForward, ExternalLink, ChevronLeft, ChevronRight, Zap, X, Cpu, HardDrive, Activity, Radio, Signal, Wifi, Clock, Maximize2, Minimize2, RotateCcw, AlertTriangle, RefreshCw } from 'lucide-react';
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

const formatTime = (ms) => {
  if (isNaN(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { console.error("[Signal Crash]", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-brand-dark flex flex-col items-center justify-center p-8 text-center font-black">
          <div className="relative group mb-12">
            <div className="absolute inset-0 bg-red-500/20 blur-[100px] animate-pulse rounded-full" />
            <AlertTriangle className="text-red-500 group-hover:scale-110 transition-transform relative z-10" size={120} strokeWidth={1.5} />
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap bg-red-500 text-black px-6 py-1 tracking-[0.5em] text-[10px] skew-x-[-20deg]">SIGNAL_LOST // DECODING_ERR</div>
          </div>
          <h1 className="text-4xl lg:text-6xl text-white uppercase tracking-tighter mb-4 max-w-2xl px-4">Neural Buffer Overload</h1>
          <p className="text-brand-text-dim text-lg mb-12 max-w-xl uppercase tracking-widest font-mono opacity-50">
            Internal decrypt signal failed. The dashboard has encountered a critical parity error.
          </p>
          <div className="flex flex-col gap-4">
            <button 
              onClick={() => window.location.reload()} 
              className="px-10 py-5 bg-white text-black text-sm uppercase tracking-[0.5em] hover:bg-brand-accent transition-all flex items-center gap-4 group"
            >
              <RefreshCw size={18} className="group-hover:rotate-180 transition-transform duration-700" /> Reboot Interface
            </button>
            <div className="text-[10px] font-mono text-red-500/50 uppercase tracking-tighter">ERROR: {this.state.error?.message || "UNDEFINED_FRAGMENT"}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  const [uptime, setUptime] = useState("00:00:00");
  const [isLyricsExpanded, setIsLyricsExpanded] = useState(false);
  const [isStatsExpanded, setIsStatsExpanded] = useState(false);
  const expandedContainerRef = useRef(null);
  const expandedActiveRef = useRef(null);

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

    const uptimeInterval = setInterval(() => {
      const now = new Date();
      setUptime(now.toTimeString().split(' ')[0]);
    }, 1000);

    return () => { 
      clearInterval(pollInterval); 
      clearInterval(statsInterval); 
      clearInterval(uptimeInterval);
    };
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

      const track = resp.data.songs && resp.data.songs[0];
      if (track && track.title !== currentTrackTitle) {
        setCurrentTrackTitle(track.title);
        updateDiscordRichPresence(track, serverMs);
      }
    } catch (err) {}
  };

  const updateDiscordRichPresence = async (track, playbackMs = 0) => {
    if (!discordSdkRef.current || !track) return;
    try {
      await discordSdkRef.current.commands.setActivity({
        activity: {
          type: 2, // Listening to
          details: track.title,
          state: `by ${track.author}`,
          assets: {
            large_image: track.thumbnail || "https://cdn.discordapp.com/embed/avatars/0.png",
            large_text: import.meta.env.VITE_APP_NAME || "AH Music"
          },
          timestamps: {
            start: Date.now() - playbackMs
          }
        }
      });
      console.log("[Discord SDK] Presence synced:", track.title);
    } catch (err) {
      console.warn("[Discord SDK] setActivity failed:", err.message);
    }
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
    // Normal Sync (Bounded Scroll)
    if (activeLyricRef.current && !isAutoScrollPaused && lyricsContainerRef.current) {
        const activeLine = activeLyricRef.current;
        const container = lyricsContainerRef.current;
        const targetScroll = activeLine.offsetTop - (container.offsetHeight / 2) + (activeLine.offsetHeight / 2);
        container.scrollTo({ top: targetScroll, behavior: 'smooth' });
    }
    // Expanded Sync (Bounded Scroll with Header Offset)
    if (expandedActiveRef.current && !isAutoScrollPaused && expandedContainerRef.current) {
        const activeLine = expandedActiveRef.current;
        const container = expandedContainerRef.current;
        // Shift target scroll UP by 100px to push content DOWN from the header
        const targetScroll = activeLine.offsetTop - (container.offsetHeight / 2) + (activeLine.offsetHeight / 2) - 100;
        container.scrollTo({ top: targetScroll, behavior: 'smooth' });
    }
  }, [activeLyricIndex, isAutoScrollPaused, isLyricsExpanded]);

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
    try { 
      if (action === 'clear' || action === 'stop') setQueue([]); 
      await axios.post(`${API_BASE}/api/control/${guildId}`, { action }); 
      fetchQueue(guildId); 
    } catch (err) {}
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
      <div className="relative">
        <Loader2 className="animate-spin text-brand-accent" size={48} />
        <div className="absolute inset-0 blur-xl bg-brand-accent/20 animate-pulse" />
      </div>
      <div className="label-caps animate-pulse text-sm">Neural Link Active</div>
    </div>
  );

  return (
    <div className="h-screen w-screen bg-mesh bg-fixed selection:bg-brand-accent selection:text-brand-dark flex flex-col overflow-hidden relative">

      {/* Background Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
         <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-brand-accent/5 blur-[100px] rounded-full animate-pulse-glow" />
         <div className="absolute bottom-[-5%] right-[-5%] w-[40%] h-[40%] bg-brand-accent/10 blur-[80px] rounded-full animate-pulse-glow" style={{ animationDelay: '2s' }} />
      </div>

      <header className="fixed top-0 left-0 right-0 h-auto lg:h-16 border-b border-white/5 bg-[#0a0a0a]/90 backdrop-blur-3xl z-50 px-4 flex flex-col lg:flex-row items-center justify-between py-3 lg:py-0 gap-3 lg:gap-0">
        {/* TOP ROW: CORE + MINI USER (Horizontal on ALL devices) */}
        <div className="w-full flex items-center justify-between lg:w-auto lg:gap-6 lg:min-w-[240px]">
          {/* NEURAL CORE */}
          <div className="flex items-center gap-3">
             <div className="w-9 h-9 glass-card flex items-center justify-center border-brand-accent/30 relative">
               <Zap className="text-brand-accent" size={18} fill="currentColor" />
               <div className="absolute -top-1 -right-1 w-2 h-2 bg-brand-accent rounded-full shadow-[0_0_8px_#00ffbf]" />
             </div>
             <div className="flex flex-col">
               <span className="font-black text-[12px] uppercase tracking-tighter leading-none">{import.meta.env.VITE_APP_NAME || 'AH MUSIC'}</span>
                <span className="text-[9px] text-brand-accent font-mono tracking-tighter uppercase opacity-50 font-bold tracking-[0.1em]">V{systemStats?.version || '5.1.9'} // PRESENCE_OPTIMIZED</span>
             </div>
          </div>
          
          {/* MOBILE USER NODE (Only visible in top row on mobile) */}
          <div className="lg:hidden flex items-center gap-3">
             <div className="flex flex-col items-end leading-none">
                <span className="text-[10px] font-black uppercase text-white tracking-widest">{auth?.user?.username || 'GUEST'}</span>
                <span className="text-[8px] font-mono uppercase text-brand-accent font-bold">{voiceChannel}</span>
             </div>
             <div className="w-8 h-8 rounded-full glass-card flex items-center justify-center border-brand-accent/20 overflow-hidden">
               <User size={16} className="text-brand-accent" />
             </div>
          </div>

          <div className="hidden lg:flex items-center gap-4 pl-6 border-l border-white/5 h-8">
             <div className="flex flex-col">
                <span className="text-[8px] font-mono text-white/30 uppercase tracking-[0.2em] font-bold">NODE_UPTIME</span>
                <span className="text-[10px] font-mono text-brand-accent font-black tracking-tighter">{uptime}</span>
             </div>
             
             {/* MODULAR STATS TOGGLE */}
             <div className="flex items-center gap-3 ml-2 border-l border-white/10 pl-4">
                <button 
                  onClick={() => setIsStatsExpanded(!isStatsExpanded)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all border ${isStatsExpanded ? 'bg-brand-accent/10 border-brand-accent/30' : 'bg-white/5 border-white/10 hover:border-brand-accent/50 group'}`}
                >
                  <Activity size={12} className={isStatsExpanded ? 'text-brand-accent animate-pulse' : 'text-brand-text-dim group-hover:text-brand-accent'} />
                  <span className={`text-[9px] font-black uppercase tracking-widest ${isStatsExpanded ? 'text-brand-accent' : 'text-brand-text-dim'}`}>
                    {isStatsExpanded ? 'Live HUD' : 'Stats'}
                  </span>
                </button>

                <AnimatePresence>
                  {isStatsExpanded && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10, scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -10, scale: 0.95 }}
                      className="flex items-center gap-4 py-1.5 px-4 bg-white/[0.03] border border-white/5 rounded-xl"
                    >
                      <div className="flex flex-col">
                         <div className="text-[7px] font-mono text-brand-text-dim uppercase tracking-tighter leading-none mb-1">CPU</div>
                         <div className="text-[10px] font-black font-mono text-brand-accent leading-none">{systemStats?.load || '0.00'}</div>
                      </div>
                      <div className="w-[1px] h-3 bg-white/10" />
                      <div className="flex flex-col">
                         <div className="text-[7px] font-mono text-brand-text-dim uppercase tracking-tighter leading-none mb-1">MEM</div>
                         <div className="text-[10px] font-black font-mono text-brand-accent leading-none">{systemStats?.mem?.percent ? `${systemStats.mem.percent}%` : '0%'}</div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
             </div>
          </div>
        </div>

        {/* SEARCH ROW: Dedicated full-width row on mobile */}
        <div className="w-full lg:flex-1 flex justify-center lg:max-w-[600px] lg:px-8 order-3 lg:order-2">
          <form onSubmit={handleSearch} className="relative w-full group">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-brand-text-dim group-focus-within:text-brand-accent z-10 transition-colors" size={18} />
            <input 
              type="text" 
              placeholder="Search music..." 
              className="w-full bg-white/5 border border-white/10 rounded-full pl-14 pr-10 h-11 text-sm outline-none focus:border-brand-accent/50 focus:bg-brand-accent/[0.03] transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isSearching && <div className="absolute right-5 top-1/2 -translate-y-1/2"><Loader2 className="animate-spin text-brand-accent" size={16} /></div>}
          </form>
        </div>

        {/* DESKTOP USER BIO (Hidden on mobile row) */}
        <div className="hidden lg:flex items-center justify-end gap-6 min-w-[240px] order-2 lg:order-3">
          <div className="flex items-center leading-none gap-4 pr-6 border-r border-white/5 h-8 justify-center">
             <div className="flex flex-row items-center gap-4">
                <div className="flex items-center gap-1.5 order-2">
                   <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                   <span className="text-[10px] font-black uppercase text-white tracking-widest leading-none">{auth?.user?.username || 'GUEST'}</span>
                </div>
                <div className="flex items-center gap-1 opacity-50 border-r border-white/10 pr-4 order-1 text-brand-accent">
                   <Signal size={12} className="pb-0.5" />
                   <span className="text-[9px] font-mono uppercase tracking-tighter font-bold">{voiceChannel}</span>
                </div>
             </div>
          </div>
          <div className="w-10 h-10 rounded-full glass-card flex items-center justify-center border-brand-accent/20 overflow-hidden shrink-0 group hover:border-brand-accent transition-colors bg-white/5">
             {auth?.user?.avatar ? (
               <img 
                 src={`https://cdn.discordapp.com/avatars/${auth.user.id}/${auth.user.avatar}.png?size=64`} 
                 alt="User" 
                 className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
               />
             ) : (
               <User size={20} className="text-brand-text-dim group-hover:text-brand-accent" />
             )}
          </div>
        </div>

      </header>



      <main className="flex-1 mt-24 lg:mt-16 overflow-hidden px-4 lg:px-6 py-4 lg:grid lg:grid-cols-12 gap-6 relative z-10 w-full mb-4">
        
        {/* PLAYER & LYRICS */}
        <div className="flex flex-col gap-6 lg:col-span-8 lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden min-w-0">
          
          {/* PLAYER CARD */}
          <div className="glass-card p-6 lg:p-10 flex flex-col sm:flex-row gap-8 lg:gap-10 relative overflow-hidden group shrink-0">
            {currentTrack && (
              <div className="absolute inset-0 blur-[120px] opacity-10 pointer-events-none group-hover:opacity-20 transition-opacity">
                <img src={getProxyUrl(currentTrack.thumbnail)} alt="" className="w-full h-full object-cover" />
              </div>
            )}

            {currentTrack ? (
              <>
                <div className="w-full sm:w-64 lg:w-80 flex-shrink-0">
                  <div className="relative aspect-square rounded-[2rem] overflow-hidden shadow-2xl border border-white/5 mx-auto sm:mx-0 max-w-[280px] sm:max-w-none hover:scale-[1.02] transition-transform duration-500">
                    <img src={getProxyUrl(currentTrack.thumbnail)} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/60 via-transparent to-transparent opacity-60" />
                    <div className="absolute bottom-6 left-6 flex gap-1.5 items-end h-8">
                      {[...Array(10)].map((_, i) => <div key={i} className="visual-bar w-[4px] bg-brand-accent" style={{ animationDelay: `${i*0.1}s` }} />)}
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0 text-center sm:text-left pt-4 sm:pt-0">
                  <div className="label-caps mb-3 text-brand-accent/50 text-[10px] flex items-center gap-2 justify-center sm:justify-start">
                     <span className="w-1.5 h-1.5 rounded-full bg-brand-accent" />
                     Signal Output // Active
                  </div>
                  <h1 className="text-3xl lg:text-5xl font-black tracking-tighter mb-2 truncate leading-none uppercase">
                    {currentTrack.title}
                  </h1>
                  <p className="text-brand-accent text-lg lg:text-xl font-bold mb-8 lg:mb-12 truncate opacity-80 uppercase tracking-widest">
                    {currentTrack.author}
                  </p>

                  <div className="flex flex-col gap-3 mb-10 lg:mb-12">
                    <input type="range" min="0" max={currentTrack.totalDurationMs || currentTrack.duration || 100} value={currentTime} onChange={(e) => setCurrentTime(parseFloat(e.target.value))} className="w-full accent-brand-accent cursor-pointer h-1.5 bg-white/10 rounded-full appearance-none" />
                    <div className="flex justify-between text-[11px] font-mono text-brand-text-dim tracking-widest font-black uppercase">
                       <span>{formatTime(currentTime)}</span>
                       <span>{formatTime(currentTrack.totalDurationMs || currentTrack.duration || 0)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-center sm:justify-start gap-5 lg:gap-8">
                    <button onClick={() => handleControl(isPlaying ? 'pause' : 'resume')} className="btn-mint w-16 h-16 lg:w-20 lg:h-20 flex items-center justify-center p-0 rounded-3xl shadow-neon-strong active:scale-95 transition-all">
                      {isPlaying ? <Pause size={32} lg:size={40} fill="currentColor" /> : <Play size={32} lg:size={40} fill="currentColor" className="ml-1" />}
                    </button>
                    <button onClick={() => handleControl('skip')} className="w-12 h-12 lg:w-16 lg:h-16 glass-card hover:border-brand-accent transition-all flex items-center justify-center rounded-2xl active:scale-90 bg-white/5 border-white/5">
                      <SkipForward size={24} lg:size={32} />
                    </button>
                    <button onClick={() => handleControl('clear')} className="w-12 h-12 lg:w-16 lg:h-16 glass-card hover:border-red-500 hover:text-red-500 hover:bg-red-500/5 transition-all flex items-center justify-center rounded-2xl active:scale-90 bg-white/5 border-white/5">
                      <Trash2 size={24} lg:size={32} />
                    </button>
                    <button onClick={() => currentTrack.actualUrl && discordSdkRef.current?.commands.openExternalLink({ url: currentTrack.actualUrl })} className="hidden sm:flex w-12 h-12 lg:w-16 lg:h-16 glass-card hover:border-brand-accent transition-all items-center justify-center rounded-2xl active:scale-90 bg-white/5 border-white/5">
                      <ExternalLink size={20} lg:size={28} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-64 lg:h-[400px] flex flex-col items-center justify-center gap-6 opacity-10">
                <Music size={80} className="text-brand-text-dim animate-pulse" strokeWidth={1} />
                <div className="label-caps text-xl tracking-[0.5em]">Network Standby</div>
              </div>
            )}
          </div>

          {/* LYRICS PANEL */}
          <div className="flex-1 glass-card overflow-hidden flex flex-col min-h-[400px] lg:min-h-0 bg-white/[0.03]">
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <BookOpen size={18} className="text-brand-accent" />
                <span className="label-caps mb-0 text-[10px] tracking-widest uppercase">Subtitles // {isPlaying ? 'DECODING' : 'IDLE'}</span>
              </div>
              <div className="flex items-center gap-4">
                 <div className="flex items-center glass-card p-1 rounded-xl bg-black/20 border-white/5 mx-2">
                    <button onClick={() => handleSync(-500)} className="p-2 hover:text-brand-accent"><ChevronLeft size={18} /></button>
                    <span className="text-[10px] font-mono text-brand-accent font-black w-14 text-center">{lyricOffsetMs}ms</span>
                    <button onClick={() => handleSync(500)} className="p-2 hover:text-brand-accent"><ChevronRight size={18} /></button>
                 </div>
                 <button onClick={() => {
                   const guildId = auth?.guild_id || new URLSearchParams(window.location.search).get('guild_id');
                   axios.post(`${API_BASE}/api/source/${guildId}`).catch(e => console.error('Rotate error:', e));
                 }} className="hidden md:flex px-5 py-2.5 glass-card text-[10px] font-black hover:border-brand-accent transition-all uppercase tracking-widest active:scale-95 border-white/10">Rotate</button>
                 <button onClick={() => setIsLyricsExpanded(true)} className="w-10 h-10 flex items-center justify-center glass-card hover:border-brand-accent transition-all border-white/10 shrink-0">
                   <Maximize2 size={18} className="text-brand-accent" />
                 </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-10 lg:p-20 no-scrollbar scroll-smooth relative" ref={lyricsContainerRef} onWheel={() => setIsAutoScrollPaused(true)} onTouchStart={() => setIsAutoScrollPaused(true)}>
              {isAutoScrollPaused && lyrics.length > 0 && (
                <button 
                  onClick={() => setIsAutoScrollPaused(false)}
                  className="sticky top-0 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 bg-brand-accent text-black font-black text-[10px] uppercase tracking-widest rounded-full shadow-neon translate-y-4 animate-bounce hover:scale-105 transition-transform"
                >
                  <RotateCcw size={12} /> Resume Sync
                </button>
              )}
              {isLyricsLoading ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-brand-accent" size={48} /></div>
              ) : lyrics.length > 0 ? (
                <div className="flex flex-col gap-6 py-4 text-center">
                  {lyrics.map((line, idx) => {
                    const isActive = idx === activeLyricIndex;
                    return (
                      <div 
                        key={idx} 
                        ref={isActive ? activeLyricRef : null} 
                        className={`text-base sm:text-lg lg:text-xl font-bold transition-all duration-700 transform leading-snug py-1.5 ${
                          isActive 
                            ? 'text-brand-accent scale-105 opacity-100 drop-shadow-[0_0_15px_rgba(0,255,191,0.5)]' 
                            : 'text-white/50 opacity-80 hover:opacity-100 transition-opacity cursor-default'
                        }`}
                      >
                        {line.text}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-12">
                   <div className="grid grid-cols-4 gap-4 w-64 opacity-10 mb-12">
                      {[...Array(16)].map((_, i) => <div key={i} className="h-4 bg-brand-accent rounded-sm animate-pulse" style={{ animationDelay: `${i*0.1}s` }} />)}
                   </div>
                   <div className="flex flex-col items-center gap-4 opacity-20">
                      <Signal size={48} className="text-brand-accent animate-pulse" />
                      <div className="text-[12px] font-black uppercase tracking-[0.5em]">SIGNAL_STANDBY</div>
                      <div className="text-[10px] font-mono uppercase tracking-widest opacity-50">awaiting incoming stream decrypt...</div>
                   </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-4 flex flex-col gap-6 lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden min-w-0 pt-6 lg:pt-0">
          
          {/* QUEUE */}
          <div className="lg:flex-[0.45] glass-card flex flex-col overflow-hidden bg-white/[0.03]">
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
               <div className="flex items-center gap-3">
                 <ListMusic size={18} className="text-brand-accent" />
                 <span className="label-caps mb-0 text-[10px]">Queue Buffer</span>
               </div>
               <span className="text-[10px] font-mono font-black text-brand-accent bg-brand-accent/10 px-2 py-0.5 rounded-full">{Math.max(0, queue.length - 1)}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 no-scrollbar pb-12">
              <AnimatePresence mode="popLayout">
                {queue.length > 1 ? queue.slice(1).map((track, idx) => (
                   <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} key={`${track.id}-${idx}`} className="group glass-card p-3 flex items-center gap-4 hover:border-brand-accent/30 bg-white/[0.01] transition-all border-white/5">
                     <img src={getProxyUrl(track.thumbnail)} className="w-12 h-12 rounded-xl object-cover" alt="" />
                     <div className="flex-1 min-w-0">
                       <div className="text-[12px] font-black truncate group-hover:text-brand-accent transition-colors uppercase tracking-widest">{track.title}</div>
                       <div className="text-[10px] text-brand-text-dim truncate font-bold uppercase opacity-50 mt-1">{track.author}</div>
                     </div>
                     <button onClick={() => handleRemove(idx + 1)} className="lg:opacity-0 group-hover:opacity-100 hover:text-white p-2">
                       <Trash2 size={16} className="text-red-500/50 hover:text-red-500" />
                     </button>
                   </motion.div>
                )) : (
                  <div className="h-full flex flex-col items-center justify-center opacity-10 py-12 text-[10px] font-black tracking-widest uppercase">Buffer Empty</div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* DISCOVERY */}
          <div className="lg:flex-[0.55] glass-card flex flex-col overflow-hidden bg-white/[0.03]">
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <Globe size={18} className="text-brand-accent" />
                <span className="label-caps mb-0 text-[10px]">Neural Discovery</span>
              </div>
              {searchResults.length > 0 && <button onClick={() => setSearchResults([])} className="p-2 px-4 glass-card text-[9px] font-black text-red-500 hover:bg-red-500/10 active:scale-95 transition-all border-red-500/20">FLUSH</button>}
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 no-scrollbar pb-16">
              <AnimatePresence>
                {searchResults.map((t) => (
                   <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} key={t.id} className="glass-card p-4 flex items-center gap-4 hover:border-brand-accent group overflow-hidden relative transition-all active:scale-[0.98] border-white/5">
                     <img src={getProxyUrl(t.thumbnail)} className="w-14 h-14 rounded-2xl object-cover z-10" alt="" />
                     <div className="flex-1 min-w-0 z-10">
                       <div className="text-[13px] font-black truncate group-hover:text-brand-accent transition-colors uppercase tracking-widest">{t.title}</div>
                       <div className="text-[10px] text-brand-text-dim truncate font-bold opacity-50 mt-1 uppercase leading-none">{t.author}</div>
                     </div>
                     <button onClick={() => handleAdd(t)} disabled={addingIds.has(t.id)} className="w-10 h-10 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center hover:bg-brand-accent hover:text-brand-dark transition-all z-10 border border-brand-accent/20">
                       {addingIds.has(t.id) ? <Loader2 size={18} className="animate-spin" /> : <Plus size={22} />}
                     </button>
                     <div className="absolute inset-0 bg-brand-accent/[0.05] translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                   </motion.div>
                ))}
              </AnimatePresence>
              {!isSearching && searchResults.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center gap-8 opacity-10 text-center p-8">
                   <div className="relative">
                      <Search size={40} strokeWidth={1} />
                      <div className="absolute inset-0 blur-xl bg-brand-accent/30 animate-pulse" />
                   </div>
                   <p className="text-[10px] font-black uppercase tracking-[0.4em] leading-relaxed">Broadcast to <br/> Capture Content</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Global Toast Overlay */}
      <AnimatePresence>
        {lastAdded && (
          <motion.div initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: -40 }} exit={{ opacity: 0, y: 100 }} className="fixed bottom-0 left-1/2 -translate-x-1/2 px-10 py-5 bg-brand-accent text-brand-dark font-black rounded-[2rem] shadow-neon-strong z-[200] flex items-center gap-6 whitespace-nowrap border-t-2 border-white/20">
            <Zap size={24} fill="currentColor" />
            <div className="flex flex-col leading-none">
               <span className="text-[10px] uppercase tracking-[0.2em] opacity-80 mb-1 font-bold">Node Initialized</span>
               <span className="text-base tracking-tight truncate uppercase">{lastAdded}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* FULL SCREEN LYRICS OVERLAY */}
      <AnimatePresence>
        {isLyricsExpanded && (
          <motion.div 
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="fixed inset-0 z-[200] bg-brand-dark/95 backdrop-blur-[50px] flex flex-col items-center justify-center p-8 overflow-hidden"
          >
            <button 
              onClick={() => setIsLyricsExpanded(false)}
              className="absolute top-10 right-10 w-16 h-16 flex items-center justify-center glass-card hover:border-brand-accent transition-all border-white/10 group active:scale-90"
            >
              <Minimize2 size={32} className="text-brand-text-dim group-hover:text-brand-accent transition-colors" />
            </button>

            <div className="w-full max-w-5xl h-full flex flex-col">
               <div className="flex-shrink-0 flex flex-col items-center mb-12">
                  <span className="label-caps text-brand-accent mb-4 tracking-[0.5em] text-sm animate-pulse">Immersive Output // Stable</span>
                  <h2 className="text-2xl lg:text-4xl font-black uppercase tracking-tighter text-white opacity-80 truncate w-full max-w-4xl text-center px-6">{currentTrack?.title}</h2>
                  <p className="text-brand-accent font-bold tracking-widest mt-2">{currentTrack?.author}</p>
               </div>

               <div className="flex-1 overflow-y-auto no-scrollbar scroll-smooth flex flex-col px-4" ref={expandedContainerRef} onWheel={() => setIsAutoScrollPaused(true)}>
                  <div className="flex flex-col gap-12 lg:gap-20 py-[40vh] items-center text-center">
                    {lyrics.map((line, idx) => {
                      const isActive = idx === activeLyricIndex;
                      return (
                        <div 
                          key={idx} 
                          ref={isActive ? expandedActiveRef : null} 
                          className={`text-4xl sm:text-5xl lg:text-7xl font-black transition-all duration-700 transform leading-tight max-w-4xl ${
                            isActive 
                              ? 'text-brand-accent scale-110 opacity-100 drop-shadow-[0_0_30px_rgba(0,255,191,0.5)]' 
                              : 'text-white/20 opacity-40 blur-[2px] transition-all'
                          }`}
                        >
                          {line.text}
                        </div>
                      );
                    })}
                  </div>
               </div>

               {isAutoScrollPaused && (
                <div className="flex justify-center mt-8">
                  <button 
                    onClick={() => setIsAutoScrollPaused(false)}
                    className="flex items-center gap-3 px-8 py-4 bg-brand-accent text-black font-black uppercase tracking-[0.3em] rounded-full shadow-neon scale-110 active:scale-95 transition-all"
                  >
                    <RotateCcw size={18} /> Re-Sync
                  </button>
                </div>
               )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
