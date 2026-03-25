# 🎸 AH-Music & Ghubbot: The Gold Standard Discord Suite

A high-performance, premium Discord music bot and social utility system, engineered for **Google Cloud** and optimized for **Discord Activities**.

---

## 💎 Premium Features (v2.7.0-PRO)

### **1. Elite Activity Dashboard**
Experience your music in high definition with our custom-built React Activity.
- **Adaptive Ambient Glow**: The dashboard's background dynamically shifts to match the color of the current track's artwork.
- **High-Res Lyric Engine**: 256ms polling for studio-smooth lyric scrolling.
- **Source Rotation**: Instantly cycle through lyric providers (LrcLib, YouTube Captions) to find the perfect sync.
- **Live Telemetry**: Monitor the bot's health in real-time with an integrated RAM % and CPU Load dashboard.

### **2. Performance Sentinel**
Optimized for resource-constrained environments (GCP e2-micro):
- **Zero-Leak Architecture**: Explicitly tracks and terminates `yt-dlp` and `ffmpeg` processes via `SIGKILL` on skip/stop.
- **Automated Memory Purge**: 10-minute idle threshold that wipes caches and resets system state to keep memory lean.
- **HLS Direct Streaming**: Efficient live-radio handling without excessive buffer overhead.

### **3. Silent Service (Ghubbot)**
- **Radio Silence**: All auto-responders and chatty mentions have been removed for a clean, non-intrusive server experience.
- **Background XP**: Quietly tracks levels and social stats without ever sending unprompted messages.

---

## 🛠️ Infrastructure

- **Host**: Google Cloud Platform (Oregon, US)
- **Engine**: Node.js 22.x (Optimized for signature solving)
- **Web**: Caddy (Automatic HTTPS + Reverse Proxy)
- **Process Mgmt**: PM2 (24/7 Uptime)

---

## 📖 Deep-Dive Documentation

For a full understanding of the codebase, view our line-by-line breakdowns:
- [Server Hub (index.js)](./brain/6682bdf7-923a-4eb3-8006-199fc64aa332/breakdown_index_js.md)
- [Playback Engine (play.js)](./brain/6682bdf7-923a-4eb3-8006-199fc64aa332/breakdown_play_js.md)
- [React Frontend (App.jsx)](./brain/6682bdf7-923a-4eb3-8006-199fc64aa332/breakdown_app_jsx.md)
- [System Architecture & Flow](./brain/6682bdf7-923a-4eb3-8006-199fc64aa332/system_architecture.md)

---

## 🚀 Quick Start (SSH)

```bash
# Register commands / Start services
pm2 restart AH-Music
pm2 restart ghubbot

# Check Load
uptime
```

*Built with ❤️ for GSUS by Antigravity*
