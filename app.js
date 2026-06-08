'use strict';

(function () {
  const video = document.getElementById('video');
  const standby = document.getElementById('standby');
  const unmuteBtn = document.getElementById('unmute');
  const fullscreenBtn = document.getElementById('fullscreen');
  const chatToggle = document.getElementById('chat-toggle');
  const chatCollapseBtn = document.getElementById('chat-collapse');
  const chatBadge = document.getElementById('chat-badge');
  const chat = document.getElementById('chat');
  const app = document.getElementById('app');
  const messagesEl = document.getElementById('messages');
  const meEl = document.getElementById('me');
  const viewerCountEl = document.getElementById('viewer-count');
  const reactionLayer = document.getElementById('reaction-layer');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');

  const EMOJI = ['👏', '🔥', '❤️', '😂', '🎉', '🤯'];

  let myName = '';
  let hls = null;
  let started = false;
  let pollTimer = null;

  // Chat open/closed + unread tracking
  let chatOpen = window.innerWidth > 820;
  let unread = 0;
  const msgEls = new Map(); // id -> message element (for live reaction updates)

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
    const recording = cfg.mode === 'recording';
    if (!url) {
      // No stream yet — keep the standby screen, hide playback affordances.
      unmuteBtn.classList.add('hidden');
      return;
    }
    if (started) return;
    started = true;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

    if (recording) startRecording(url);
    else startLive(url);
  }

  // Live channel: muted autoplay, no controls, snap to the live edge.
  function startLive(url) {
    standby.classList.add('hidden');
    unmuteBtn.classList.remove('hidden');
    attach(url, true);
  }

  // After the event: a normal video player with full controls + sound.
  function startRecording(url) {
    document.body.classList.add('recording');
    unmuteBtn.classList.add('hidden');
    video.controls = true;
    video.removeAttribute('autoplay');
    video.muted = false;
    video.style.pointerEvents = 'auto';
    const badge = document.querySelector('.live-badge');
    if (badge) { badge.classList.add('replay'); badge.textContent = 'REPLAY'; }
    const h2 = document.querySelector('.chat-head h2');
    if (h2) h2.textContent = 'Chat';
    attach(url, false);
    showEndedStandby();
  }

  function showEndedStandby() {
    standby.classList.remove('hidden');
    standby.textContent = '';
    const card = document.createElement('div');
    card.className = 'standby-card';
    const logo = document.createElement('div');
    logo.className = 'standby-logo';
    logo.textContent = '🍎';
    const h1 = document.createElement('h1');
    h1.textContent = "That's a wrap";
    const sub = document.createElement('p');
    sub.className = 'standby-sub';
    sub.textContent = 'The keynote has ended';
    const hint = document.createElement('p');
    hint.className = 'standby-hint';
    hint.textContent = 'Watch the full recording below — with playback and volume controls.';
    const btn = document.createElement('button');
    btn.className = 'play-btn';
    btn.type = 'button';
    btn.textContent = '▶  Watch the recording';
    btn.addEventListener('click', () => {
      standby.classList.add('hidden');
      video.muted = false;
      video.play().catch(() => {});
    });
    card.append(logo, h1, sub, hint, btn);
    standby.appendChild(card);
  }

  function initStream() {
    checkConfig();
    // Keep checking so a standby viewer auto-flips to live the moment the
    // stream URL is dropped into config.json — no manual refresh needed.
    pollTimer = setInterval(() => { if (!started) checkConfig(); }, 10000);
  }

  function attach(url, isLive) {
    const isM3u8 = /\.m3u8(\?|$)/i.test(url);

    if (isM3u8 && window.Hls && window.Hls.isSupported()) {
      if (hls) { hls.destroy(); hls = null; }
      hls = new Hls({
        lowLatencyMode: isLive,
        liveSyncDurationCount: 3,
        enableWorker: true,
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { if (isLive) seekToLiveAndPlay(); });
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
            setTimeout(() => attach(url, isLive), 3000);
        }
      });
    } else {
      // Native HLS (Safari) or a plain video URL.
      video.src = url;
      if (isLive) video.addEventListener('loadedmetadata', seekToLiveAndPlay, { once: true });
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

  // ---------- Chat collapse / reopen ----------
  function applyChatState() {
    app.classList.toggle('chat-collapsed', !chatOpen);
  }
  function openChat() {
    chatOpen = true;
    unread = 0;
    chatBadge.textContent = '';
    applyChatState();
  }
  function closeChat() {
    chatOpen = false;
    applyChatState();
  }
  applyChatState(); // set initial state (desktop open, mobile collapsed)
  chatToggle.addEventListener('click', openChat);
  chatCollapseBtn.addEventListener('click', closeChat);

  // ---------- WebSocket ----------
  let ws;
  let reconnectTimer = null;

  function connect() {
    let wsUrl = BACKEND.replace(/^http/, 'ws');
    // Reuse our previous name so reconnects don't rename us.
    let saved = null;
    try { saved = localStorage.getItem('wwdc_name'); } catch (_e) {}
    if (saved) wsUrl += (wsUrl.includes('?') ? '&' : '?') + 'name=' + encodeURIComponent(saved);
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
        try { localStorage.setItem('wwdc_name', myName); } catch (_e) {}
        meEl.textContent = 'You: ' + myName;
        setViewers(msg.viewers);
        if (Array.isArray(msg.history)) {
          msg.history.forEach((m) => addChat(m, true));
        }
        break;
      case 'chat':
        addChat(msg, false);
        if (msg.name !== myName && !chatOpen) {
          unread += 1;
          chatBadge.textContent = unread > 99 ? '99+' : String(unread);
        }
        break;
      case 'msgreact':
        applyReaction(msg.id, msg.emoji, msg.count);
        break;
      case 'myreact':
        applyMine(msg.id, msg.emoji, msg.active);
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

  function addChat(msg, isHistory) {
    const stick = nearBottom();
    const mine = msg.name === myName;
    const div = document.createElement('div');
    div.className = 'msg' + (mine ? ' mine' : '');
    if (msg.id) div.dataset.id = msg.id;

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = msg.name;
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = msg.text;
    div.appendChild(who);
    div.appendChild(what);

    if (msg.id) {
      div.appendChild(buildReactBar(msg.id));
      const chips = document.createElement('div');
      chips.className = 'msg-reactions';
      div.appendChild(chips);
      if (msg.reactions) {
        const mine = Array.isArray(msg.mine) ? msg.mine : [];
        Object.keys(msg.reactions).forEach((emoji) => {
          const count = msg.reactions[emoji];
          if (count > 0) {
            const chip = ensureChip(chips, msg.id, emoji);
            setCount(chip, count, false);
            chip.classList.toggle('mine', mine.indexOf(emoji) !== -1);
          }
        });
      }
      msgEls.set(msg.id, div);
    }

    messagesEl.appendChild(div);
    if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Slack-style floating quick-reaction bar that appears above a message on hover.
  function buildReactBar(id) {
    const bar = document.createElement('div');
    bar.className = 'react-bar';
    EMOJI.forEach((emoji) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = emoji;
      b.title = 'React ' + emoji;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        sendMsgReact(id, emoji);
      });
      bar.appendChild(b);
    });
    return bar;
  }

  function sendMsgReact(id, emoji) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'msgreact', id, emoji }));
  }

  // Find or create a reaction chip (emoji + count). Clicking it toggles.
  function ensureChip(chipsEl, id, emoji) {
    let chip = chipsEl.querySelector('[data-emoji="' + emoji + '"]');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.emoji = emoji;
      const e = document.createElement('span');
      e.textContent = emoji;
      const n = document.createElement('span');
      n.className = 'cn';
      chip.appendChild(e);
      chip.appendChild(n);
      chip.addEventListener('click', () => sendMsgReact(id, emoji));
      chipsEl.appendChild(chip);
    }
    return chip;
  }

  function setCount(chip, count, bump) {
    chip.querySelector('.cn').textContent = String(count);
    if (bump) {
      chip.classList.remove('bump');
      void chip.offsetWidth; // restart animation
      chip.classList.add('bump');
    }
  }

  // Live count update for everyone; removes the chip when it hits zero.
  function applyReaction(id, emoji, count) {
    const div = msgEls.get(id);
    if (!div) return; // message not in view (older than window)
    const chips = div.querySelector('.msg-reactions');
    if (!chips) return;
    let chip = chips.querySelector('[data-emoji="' + emoji + '"]');
    if (count <= 0) { if (chip) chip.remove(); return; }
    chip = ensureChip(chips, id, emoji);
    setCount(chip, count, true);
  }

  // Highlight (or un-highlight) a chip as the current user's own reaction.
  function applyMine(id, emoji, active) {
    const div = msgEls.get(id);
    if (!div) return;
    const chip = div.querySelector('.msg-reactions [data-emoji="' + emoji + '"]');
    if (chip) chip.classList.toggle('mine', active);
  }

  function addSystem(text) {
    const stick = nearBottom();
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = text;
    messagesEl.appendChild(div);
    if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Disable the send button until there's something to send.
  const sendBtn = document.getElementById('send-btn');
  function syncSendBtn() { sendBtn.disabled = chatInput.value.trim() === ''; }
  chatInput.addEventListener('input', syncSendBtn);
  syncSendBtn();

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'chat', text }));
    chatInput.value = '';
    syncSendBtn();
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
