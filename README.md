# 🎸 AH-Music: High-Performance Discord Music Bot

A premium, feature-rich Discord music bot engineered for stability and performance. Built with Node.js and optimized for low-resource environments like Google Cloud Platform (e2-micro).

## ✨ Key Features

- **🚀 High-Performance Streaming**: Optimized audio pipeline using `yt-dlp` and `@discordjs/voice` for lag-free playback.
- **📻 24/7 Radio Mode**: Dedicated `/radio` command to stream live stations or keywords (lofi, jazz, etc.) indefinitely.
- **📜 Integrated Lyrics**: Real-time synchronized lyrics fetched from LRCLIB and YouTube captions, displayed directly in the Discord embed.
- **🎮 Interactive Dashboard**: Control playback with intuitive buttons (Pause/Resume, Skip, Stop, Sync Lyrics, Download).
- **📥 Audio Downloads**: Extract and download high-quality audio directly from Discord (within size limits).
- **🧠 Auto-Play Engine**: Automatically queues similar tracks when your playlist ends to keep the music going.
- **🌐 Activity Dashboard**: Includes a React-based frontend for monitoring and controlling the bot via a web interface.
- **🛡️ Resource Efficient**: Advanced process management to prevent memory leaks and minimize CPU usage on tiny VMs.

## 🛠️ Slash Commands

| Command | Description |
| :--- | :--- |
| `/play <query>` | Play a song from YouTube, SoundCloud, or direct URL. |
| `/radio <query>`| Start a 24/7 live radio stream by keyword or URL. |
| `/status` | View real-time system diagnostics, RAM/CPU usage, and uptime. |
| `/restart` | Safely restart the bot (Bot Owner only). |
| `/ping` | Check the bot's current latency. |
| `/info` | Get information about the bot and its current version. |

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [FFmpeg](https://ffmpeg.org/download.html) (Ensure it's in your system PATH)
- A Discord Bot Token (from the [Discord Developer Portal](https://discord.com/developers/applications))

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/GSUS2K/AH-Music.git
   cd AH-Music
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables:
   Create a `.env` file in the root directory:
   ```env
   DISCORD_TOKEN=your_bot_token
   DISCORD_CLIENT_ID=your_client_id
   DISCORD_CLIENT_SECRET=your_client_secret
   DISCORD_PUBLIC_KEY=your_public_key
   PORT=3000
   ```

### Running the Bot
- **Development**:
  ```bash
  node index.js
  ```
- **Production (Recommended with PM2)**:
  ```bash
  pm2 start index.js --name AH-Music
  ```

## 🧰 Deployment Tips

- **Google Cloud (GCP)**: If running on an `e2-micro` instance, use the automated memory purge features built into the bot to keep the process lean.
- **Cookies**: To bypass YouTube bot detection, place a `cookies.txt` file in the root directory.
- **Activity Frontend**: To build the React dashboard, run:
  ```bash
  npm run build-activity
  ```

---
*Built with ❤️ for GSUS*
