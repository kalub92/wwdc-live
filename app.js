'use strict';

(function () {
  const video = document.getElementById('video');
  const standby = document.getElementById('standby');
  const unmuteBtn = document.getElementById('unmute');
  const fullscreenBtn = document.getElementById('fullscreen');
  const chatToggle = document.getElementById('chat-toggle');
  const chat = document.getElementById('chat');
  const app = document.getElementById('app');
  const messagesEl = document.getElementById('messages');
  const meEl = document.getElementById('me');
  const viewerCountEl = document.getElementById('viewer-count');
  const reactionLayer = document.getElementById('reaction-layer');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');

  let myName = '';
  let hls = null;
  let started = false;
  let pollTimer = null;

  // Backend base (Mac via Cloudflare tunnel) when served from GitHub Pages;
  // falls back to same origin when the Mac serves the page directly.
  const BACKEND = (window.WWDC_BACKEND || '').replace(/\/$/, '') || location.origin;

  // ---------- Video / HLS playback ----------
  async function checkConfig() {
    let cfg = { streamUrl: '' };
    try {
      const res = await fetch(BACKEND + '/api/config', { cache: 'no-store' });
      cfg = await res.json();
    } catch (e) {
      return; // transient; keep polling
    }
    if (cfg.title) document.title = cfg.title;

    const url = (cfg.streamUrl || '').trim();
    if (!url) {
      // No stream yet — keep the standby screen, hide playback affordances.
      unmuteBtn.classList.add('hidden');
      return;
    }
    if (started) return;
    started = true;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

    standby.classList.add('hidden');
    unmuteBtn.classList.remove('hidden');
    attach(url);
  }

  function initStream() {
    checkConfig();
    // Keep checking so a standby viewer auto-flips to live the moment the
    // stream URL is dropped into config.json — no manual refresh needed.
    pollTimer = setInterval(() => { if (!started) checkConfig(); }, 10000);
  }

  function attach(url) {
    const isM3u8 = /\.m3u8(\?|$)/i.test(url);

    if (isM3u8 && window.Hls && window.Hls.isSupported()) {
      if (hls) { hls.destroy(); hls = null; }
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        enableWorker: true,
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => seekToLiveAndPlay());
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            // Unrecoverable — try a full reattach shortly.
            setTimeout(() => attach(url), 3000);
        }
      });
    } else {
      // Native HLS (Safari) or a plain video URL.
      video.src = url;
      video.addEventListener('loadedmetadata', seekToLiveAndPlay, { once: true });
    }
  }

  function seekToLiveAndPlay() {
    try {
      if (video.seekable && video.seekable.length) {
        video.currentTime = video.seekable.end(video.seekable.length - 1);
      }
    } catch (_e) { /* ignore */ }
    video.play().catch(() => {
      // Autoplay may still be blocked; muted should allow it. If not,
      // the unmute pill doubles as a play affordance.
    });
  }

  // ---------- Unmute ----------
  unmuteBtn.addEventListener('click', () => {
    video.muted = false;
    video.volume = 1;
    video.play().catch(() => {});
    unmuteBtn.classList.add('hidden');
  });

  // ---------- Fullscreen ----------
  fullscreenBtn.addEventListener('click', () => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const target = app;
      (target.requestFullscreen || target.webkitRequestFullscreen).call(target);
    }
  });

  // ---------- Chat panel toggle (mobile / small screens) ----------
  chatToggle.addEventListener('click', () => chat.classList.toggle('open'));

  // ---------- WebSocket ----------
  let ws;
  let reconnectTimer = null;

  function connect() {
    const wsUrl = BACKEND.replace(/^http/, 'ws');
    ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
      addSystem('Connected to the watch party.');
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handle(msg);
    });

    ws.addEventListener('close', () => {
      addSystem('Disconnected. Reconnecting…');
      scheduleReconnect();
    });

    ws.addEventListener('error', () => { try { ws.close(); } catch (_e) {} });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1500);
  }

  function handle(msg) {
    switch (msg.type) {
      case 'welcome':
        myName = msg.name;
        meEl.textContent = 'You: ' + myName;
        setViewers(msg.viewers);
        if (Array.isArray(msg.history)) {
          msg.history.forEach((m) => addChat(m.name, m.text, m.name === myName));
        }
        break;
      case 'chat':
        addChat(msg.name, msg.text, msg.name === myName);
        break;
      case 'reaction':
        floatEmoji(msg.emoji);
        break;
      case 'viewers':
        setViewers(msg.count);
        break;
    }
  }

  function setViewers(n) {
    viewerCountEl.textContent = n;
  }

  // ---------- Chat rendering (XSS-safe via textContent) ----------
  function nearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  }

  function addChat(name, text, mine) {
    const stick = nearBottom();
    const div = document.createElement('div');
    div.className = 'msg' + (mine ? ' mine' : '');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = name;
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = text;
    div.appendChild(who);
    div.appendChild(what);
    messagesEl.appendChild(div);
    if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addSystem(text) {
    const stick = nearBottom();
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = text;
    messagesEl.appendChild(div);
    if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'chat', text }));
    chatInput.value = '';
  });

  // ---------- Emoji reactions ----------
  document.getElementById('reaction-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-emoji]');
    if (!btn || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'reaction', emoji: btn.dataset.emoji }));
  });

  function floatEmoji(emoji) {
    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.textContent = emoji;
    el.style.left = (8 + Math.random() * 84) + '%';
    el.style.fontSize = (32 + Math.random() * 22) + 'px';
    reactionLayer.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  // ---------- Go ----------
  initStream();
  connect();
})();
