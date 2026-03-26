const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');

// --- AETHER STREAMING SERVER ---
const streamApp = express();
streamApp.use(cors());

streamApp.get('/stream', (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('No URL provided');

    const ytdlpPath = process.env.YOUTUBE_DL_PATH || 'yt-dlp';
    const cookiesPath = path.join(__dirname, '../cookies.txt');
    
    const args = [
        videoUrl,
        '--output', '-',
        '--format', 'bestaudio[ext=webm]/bestaudio/best',
        '--no-check-certificates',
        '--no-warnings',
        '--quiet',
        '--force-ipv4',
        '--extractor-args', 'youtube:player_client=android_vr'
    ];

    if (fs.existsSync(cookiesPath)) {
        args.push('--cookies', cookiesPath);
    }

    const proc = spawn(ytdlpPath, args);

    res.setHeader('Content-Type', 'audio/webm');
    proc.stdout.pipe(res);

    req.on('close', () => {
        proc.kill('SIGKILL');
    });
});

const SERVER_PORT = 3333;
streamApp.listen(SERVER_PORT, () => {
    console.log(`[Aether] Local Stream Server running on port ${SERVER_PORT}`);
});

// --- ELECTRON LIFECYCLE ---
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#050505',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
