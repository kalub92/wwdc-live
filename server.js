'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const CONFIG_PATH = path.join(__dirname, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();

// Serve the static frontend.
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Read config fresh on every request so the stream URL can be swapped in
// by editing config.json — viewers just refresh, no server restart needed.
app.get('/api/config', (_req, res) => {
  let cfg = { streamUrl: '', title: 'WWDC Live' };
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.warn('Could not read config.json:', err.message);
  }
  res.set('Cache-Control', 'no-store');
  // Allow the GitHub Pages frontend (different origin) to read the config.
  res.set('Access-Control-Allow-Origin', '*');
  res.json({ streamUrl: cfg.streamUrl || '', title: cfg.title || 'WWDC Live' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ----- In-memory watch-party state (ephemeral) -----
const RECENT_LIMIT = 50;
const recentMessages = []; // { name, text, ts }

const ADJECTIVES = [
  'Swift', 'Retina', 'Turbo', 'Cosmic', 'Neon', 'Pixel', 'Quantum', 'Sonic',
  'Lunar', 'Electric', 'Crispy', 'Mighty', 'Velvet', 'Stellar', 'Rapid', 'Golden',
  'Silent', 'Chrome', 'Hyper', 'Vivid', 'Bold', 'Frosty', 'Atomic', 'Jolly',
];
const NOUNS = [
  'Fox', 'Falcon', 'Otter', 'Panda', 'Comet', 'Tiger', 'Dolphin', 'Wolf',
  'Raven', 'Lynx', 'Hawk', 'Koala', 'Gecko', 'Bison', 'Heron', 'Orca',
  'Badger', 'Ferret', 'Mantis', 'Puma', 'Cobra', 'Moose', 'Crane', 'Newt',
];

function randomName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const d = Math.floor(Math.random() * 90) + 10; // 10..99
  return `${a}${n}${d}`;
}

function viewerCount() {
  let count = 0;
  wss.clients.forEach((c) => {
    if (c.readyState === 1) count += 1;
  });
  return count;
}

function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(data);
  });
}

function broadcastViewers() {
  broadcast({ type: 'viewers', count: viewerCount() });
}

const ALLOWED_EMOJI = new Set(['👏', '🔥', '❤️', '😂', '🎉', '🤯']);
const MAX_MSG_LEN = 300;

wss.on('connection', (ws) => {
  ws.name = randomName();
  ws.msgTimes = []; // timestamps for simple rate limiting

  ws.send(
    JSON.stringify({
      type: 'welcome',
      name: ws.name,
      viewers: viewerCount(),
      history: recentMessages,
    })
  );
  broadcastViewers();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'chat') {
      const now = Date.now();
      // Rate limit: max ~4 messages per 2 seconds per socket.
      ws.msgTimes = ws.msgTimes.filter((t) => now - t < 2000);
      if (ws.msgTimes.length >= 4) return;
      ws.msgTimes.push(now);

      let text = typeof msg.text === 'string' ? msg.text.trim() : '';
      if (!text) return;
      if (text.length > MAX_MSG_LEN) text = text.slice(0, MAX_MSG_LEN);

      const entry = { name: ws.name, text, ts: now };
      recentMessages.push(entry);
      if (recentMessages.length > RECENT_LIMIT) recentMessages.shift();
      broadcast({ type: 'chat', ...entry });
    } else if (msg.type === 'reaction') {
      if (ALLOWED_EMOJI.has(msg.emoji)) {
        broadcast({ type: 'reaction', emoji: msg.emoji });
      }
    }
  });

  ws.on('close', () => {
    broadcastViewers();
  });

  ws.on('error', () => {
    // Ignore socket errors; close handler will fire.
  });
});

server.listen(PORT, () => {
  console.log(`WWDC Live running at http://localhost:${PORT}`);
});
