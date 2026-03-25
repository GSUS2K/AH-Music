# 🎸 AH-Music: High-Performance Discord Music Bot

A premium, feature-rich Discord music bot engineered for stability and performance. Built with Node.js and optimized for low-resource environments like Google Cloud Platform (e2-micro).

## ✨ Key Features

- **🚀 High-Performance Streaming**: Optimized audio pipeline using `yt-dlp` and `@discordjs/voice` for lag-free playback.
- **📱 Profile Status Sync**: Automatically synchronize your current song with your Discord profile status (includes "Listen Along" and "Join Activity").
- **📻 24/7 Radio Mode**: Dedicated `/radio` command to stream live stations or keywords (lofi, jazz, etc.) indefinitely.
- **📜 Integrated Lyrics**: Real-time synchronized lyrics displayed directly in the Discord embed.
- **🎮 Interactive Dashboard**: Control playback with intuitive buttons (Pause/Resume, Skip, Stop, Sync Lyrics, Download).
- **🛡️ Smart Management**: Automated memory management and process monitoring via PM2.
- **🔐 Secure & Portable**: 100% environment-driven configuration for easy deployment and security.

## 🛠️ Slash Commands

| Command | Description | Permission |
| :--- | :--- | :--- |
| `/play <query>` | Play a song from YouTube, SoundCloud, or URL. | Everyone |
| `/radio <query>`| Start a 24/7 live radio stream by keyword. | Everyone |
| `/status` | View real-time system and PM2 diagnostics. | Everyone |
| `/info` | Get system version and dashboard links. | Everyone |
| `/restart` | Update from GitHub, rebuild, and restart bot. | **Owner Only** |
| `/logs` | View the last 20 lines of bot execution logs. | **Owner Only** |

## 🚀 Quick Start

### 1. Installation
```bash
git clone https://github.com/GSUS2K/AH-Music.git
cd AH-Music
npm install
```

### 2. Configuration (.env)
Create a `.env` file in the root directory:
```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
OWNER_ID=your_discord_user_id

# System Paths
YOUTUBE_COOKIES_PATH=./cookies.txt
SYSTEM_YTDLP_PATH=/usr/local/bin/yt-dlp
EXTERNAL_DASHBOARD_URL=https://your-domain.com/activity
```

### 3. Running
- **Build the Activity Frontend**: `npm run build-activity`
- **Start with PM2**: `pm2 start index.js --name AH-Music`

## 🔄 Smart Updates
This bot supports **Remote Updates**. If you push changes to your GitHub branch, you can simply run `/restart` in Discord. The bot will automatically pull the latest code, rebuild the search engine/frontend, and refresh the process.

---
*Built with ❤️ for GSUS*
