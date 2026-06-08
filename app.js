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

  // Chat open/closed + unread tracking
  let chatOpen = window.innerWidth > 820;
  let unread = 0;
  const msgEls = new Map(); // id -> message element (for live reaction updates)

  // Backend base (Mac via Cloudflare tunnel) when served from GitHub Pages;
  // falls back to same origin when the Mac serves the page directly.
  const BACKEND = (window.WWDC_BACKEND || '').replace(/\/$/, '') || location.origin;

  // ---------- Sessions (Keynote / Platforms State of the Union …) ----------
  let sessions = [];
  let activeId = null;
  let activeMode = null;
  let appliedSig = '';        // mode|url currently attached, to avoid needless reattach
  let countdownTimer = null;
  const tabsEl = document.getElementById('tabs');
  const liveBadge = document.querySelector('.live-badge');

  async function fetchConfig() {
    let cfg;
    try {
      const res = await fetch(BACKEND + '/api/config', { cache: 'no-store' });
      cfg = await res.json();
    } catch (e) {
      return; // transient; keep polling
    }
    sessions = Array.isArray(cfg.sessions) ? cfg.sessions : [];
    if (!sessions.length) return;
    if (!activeId || !sessions.some((s) => s.id === activeId)) activeId = pickDefault();
    renderTabs();
    applyActive(false);
  }

  function pickDefault() {
    let saved = null;
    try { saved = localStorage.getItem('wwdc_tab'); } catch (_e) {}
    if (saved && sessions.some((s) => s.id === saved)) return saved;
    const live = sessions.find((s) => s.mode === 'live');
    return live ? live.id : sessions[0].id;
  }

  function statusLabel(mode) {
    if (mode === 'live') return 'live';
    if (mode === 'recording') return 'replay';
    return 'soon';
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.textContent = '';
    sessions.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab' + (s.id === activeId ? ' active' : '') + (s.mode === 'live' ? ' is-live' : '');
      const t = document.createElement('span');
      t.className = 'tab-title';
      t.textContent = s.title;
      const st = document.createElement('span');
      st.className = 'tab-status ' + s.mode;
      st.textContent = statusLabel(s.mode);
      b.append(t, st);
      b.addEventListener('click', () => {
        if (activeId === s.id) return;
        activeId = s.id;
        try { localStorage.setItem('wwdc_tab', activeId); } catch (_e) {}
        renderTabs();
        applyActive(true);
      });
      tabsEl.appendChild(b);
    });
  }

  function setBadge(mode) {
    if (!liveBadge) return;
    liveBadge.classList.remove('replay', 'soon');
    if (mode === 'live') {
      liveBadge.innerHTML = '<span class="live-dot"></span> LIVE';
    } else if (mode === 'recording') {
      liveBadge.classList.add('replay');
      liveBadge.textContent = 'REPLAY';
    } else {
      liveBadge.classList.add('soon');
      liveBadge.textContent = 'UP NEXT';
    }
  }

  function teardownVideo() {
    if (hls) { hls.destroy(); hls = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    try { video.pause(); } catch (_e) {}
    video.removeAttribute('src');
    try { video.load(); } catch (_e) {}
  }

  // Apply the active session to the player. `force` re-attaches even if unchanged.
  function applyActive(force) {
    const s = sessions.find((x) => x.id === activeId);
    if (!s) return;
    const url = (s.streamUrl || '').trim();
    const sig = s.mode + '|' + url;
    if (!force && sig === appliedSig) { setBadge(s.mode); return; }
    appliedSig = sig;

    teardownVideo();
    document.title = s.title + ' — WWDC';
    document.body.classList.toggle('recording', s.mode === 'recording');
    document.body.classList.toggle('live', s.mode === 'live');
    setBadge(s.mode);

    activeMode = s.mode;
    // Presence: always connect to the active session's room so the viewer count
    // reflects real people on every tab (live or not). Chat panel visibility is
    // decided separately (live by default; host can override).
    connectRoom(s.id);
    updateChatVisibility();

    if (s.mode === 'live' && url) {
      unmuteBtn.classList.remove('hidden');
      video.controls = false;
      video.style.pointerEvents = 'none';
      video.muted = true;
      video.setAttribute('autoplay', '');
      standby.classList.add('hidden');
      attach(url, true);
    } else if (s.mode === 'recording' && url) {
      unmuteBtn.classList.add('hidden');
      video.controls = true;
      video.removeAttribute('autoplay');
      video.muted = false;
      video.style.pointerEvents = 'auto';
      attach(url, false);
      showRecordingStandby(s);
    } else {
      // upcoming — no stream yet
      unmuteBtn.classList.add('hidden');
      video.controls = false;
      video.style.pointerEvents = 'none';
      showUpcomingStandby(s);
    }
  }

  function makeCard() {
    standby.classList.remove('hidden');
    standby.textContent = '';
    const card = document.createElement('div');
    card.className = 'standby-card';
    const logo = document.createElement('div');
    logo.className = 'standby-logo';
    logo.textContent = '🍎';
    card.appendChild(logo);
    standby.appendChild(card);
    return card;
  }

  function showRecordingStandby(s) {
    const card = makeCard();
    const h1 = document.createElement('h1'); h1.textContent = "That's a wrap";
    const sub = document.createElement('p'); sub.className = 'standby-sub'; sub.textContent = s.title + ' has ended';
    const hint = document.createElement('p'); hint.className = 'standby-hint';
    hint.textContent = 'Watch the recording below — with playback and volume controls.';
    const btn = document.createElement('button'); btn.className = 'play-btn'; btn.type = 'button';
    btn.textContent = '▶  Watch the recording';
    btn.addEventListener('click', () => { standby.classList.add('hidden'); video.muted = false; video.play().catch(() => {}); });
    card.append(h1, sub, hint, btn);
  }

  function fmtTime(d) {
    try {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short' });
    } catch (_e) { return ''; }
  }

  function showUpcomingStandby(s) {
    const card = makeCard();
    const h1 = document.createElement('h1'); h1.textContent = s.title;
    const sub = document.createElement('p'); sub.className = 'standby-sub';
    const count = document.createElement('div'); count.className = 'countdown';
    const hint = document.createElement('p'); hint.className = 'standby-hint';
    const target = s.startsAt ? new Date(s.startsAt) : null;
    const hasTarget = target && !isNaN(target.getTime());
    sub.innerHTML = '<span class="dot"></span> ' + (hasTarget ? 'Starts at ' + fmtTime(target) : 'Starting soon');
    card.append(h1, sub, count, hint);

    function tick() {
      if (!hasTarget) { count.textContent = ''; hint.textContent = 'This starts automatically when Apple goes live.'; return; }
      const ms = target.getTime() - Date.now();
      if (ms <= 0) { count.textContent = 'Starting soon…'; hint.textContent = 'Begins automatically when Apple goes live — hang tight.'; return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const sec = Math.floor((ms % 60000) / 1000);
      count.textContent = (h > 0 ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
      hint.textContent = 'Starts automatically. Hang out and chat while we wait.';
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function startSessions() {
    fetchConfig();
    // Poll so tabs reflect live/recording transitions and a session auto-starts
    // the moment its stream URL is filled in — no manual refresh needed.
    setInterval(fetchConfig, 15000);
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

  // ---------- Sound: unmute pill + volume control (live mode; no playback) ----------
  const volBtn = document.getElementById('vol-btn');
  const volSlider = document.getElementById('vol-slider');
  const ICON_ON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>';

  function syncVolumeUI() {
    const muted = video.muted || video.volume === 0;
    if (volBtn) { volBtn.innerHTML = muted ? ICON_OFF : ICON_ON; volBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute'); }
    if (volSlider) volSlider.value = muted ? 0 : video.volume;
  }
  function enableSound() {
    video.muted = false;
    if (video.volume === 0) video.volume = 1;
    video.play().catch(() => {});
    unmuteBtn.classList.add('hidden');
    syncVolumeUI();
  }

  unmuteBtn.addEventListener('click', enableSound);
  if (volSlider) volSlider.addEventListener('input', () => {
    const v = parseFloat(volSlider.value);
    video.volume = v;
    video.muted = v === 0;
    if (v > 0) { video.play().catch(() => {}); unmuteBtn.classList.add('hidden'); }
    syncVolumeUI();
  });
  if (volBtn) volBtn.addEventListener('click', () => {
    if (video.muted || video.volume === 0) enableSound();
    else { video.muted = true; syncVolumeUI(); }
  });
  video.addEventListener('volumechange', syncVolumeUI);
  syncVolumeUI();

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

  // ---------- Host (admin) controls: clear + chat toggle ----------
  let adminKey = null;
  try {
    const q = new URLSearchParams(location.search).get('admin');
    if (q) localStorage.setItem('wwdc_admin', q);
    adminKey = localStorage.getItem('wwdc_admin');
  } catch (_e) {}
  const isAdmin = !!adminKey;

  // Host override for chat visibility: null = follow default (live-only).
  let adminChatOverride = null;
  try {
    const v = localStorage.getItem('wwdc_chat_override');
    if (v === 'show') adminChatOverride = true;
    else if (v === 'hide') adminChatOverride = false;
  } catch (_e) {}

  const clearBtn = document.getElementById('clear-chat');
  if (clearBtn && isAdmin) {
    clearBtn.style.display = 'flex'; // reveal (CSS hides #clear-chat by default)
    clearBtn.addEventListener('click', () => {
      if (!confirm('Clear the ENTIRE chat for everyone? This wipes the log and cannot be undone.')) return;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'clearchat', key: adminKey }));
    });
  }

  const adminChatBtn = document.getElementById('admin-chat');
  if (adminChatBtn && isAdmin) {
    adminChatBtn.style.display = 'inline-flex'; // reveal (CSS hides it by default)
    adminChatBtn.addEventListener('click', () => {
      adminChatOverride = !chatShouldShow(); // flip current visibility
      try { localStorage.setItem('wwdc_chat_override', adminChatOverride ? 'show' : 'hide'); } catch (_e) {}
      updateChatVisibility();
    });
  }

  // Chat panel visibility: live by default; the host can force show/hide.
  function chatShouldShow() {
    if (isAdmin && adminChatOverride !== null) return adminChatOverride;
    // Show during live broadcasts and while waiting for an upcoming session
    // (hang out + chat before it starts); hidden for async recordings.
    return activeMode === 'live' || activeMode === 'upcoming';
  }
  function updateChatVisibility() {
    const show = chatShouldShow();
    app.classList.toggle('no-chat', !show);
    if (adminChatBtn) adminChatBtn.textContent = show ? '💬 Hide chat' : '💬 Show chat';
  }

  // ---------- WebSocket (per-room chat) ----------
  let ws = null;
  let currentRoom = null;   // room we want to be connected to (null = chat off)
  let chatWanted = false;
  let reconnectTimer = null;

  function clearMessages() { messagesEl.textContent = ''; msgEls.clear(); }

  // Connect to (or switch to) a chat room. No-op if already on it.
  function connectRoom(room) {
    if (chatWanted && currentRoom === room && ws && ws.readyState <= 1) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { const old = ws; ws = null; try { old.close(); } catch (_e) {} }
    currentRoom = room;
    chatWanted = true;
    clearMessages();
    connect();
  }

  // Leave chat entirely (used when the active session isn't live).
  function disconnectRoom() {
    chatWanted = false;
    currentRoom = null;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { const old = ws; ws = null; try { old.close(); } catch (_e) {} }
    clearMessages();
    setViewers(0);
  }

  function connect() {
    let url = BACKEND.replace(/^http/, 'ws');
    const qp = [];
    let saved = null;
    try { saved = localStorage.getItem('wwdc_name'); } catch (_e) {}
    if (saved) qp.push('name=' + encodeURIComponent(saved));   // sticky username across rooms
    if (currentRoom) qp.push('room=' + encodeURIComponent(currentRoom));
    if (qp.length) url += '?' + qp.join('&');

    const sock = new WebSocket(url);
    ws = sock;
    sock.addEventListener('open', () => { addSystem('Connected to the chat.'); });
    sock.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handle(msg);
    });
    sock.addEventListener('close', () => {
      if (sock === ws && chatWanted) { addSystem('Disconnected. Reconnecting…'); scheduleReconnect(); }
    });
    sock.addEventListener('error', () => { try { sock.close(); } catch (_e) {} });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (chatWanted) connect();
    }, 1500);
  }

  function handle(msg) {
    switch (msg.type) {
      case 'welcome':
        myName = msg.name;
        try { localStorage.setItem('wwdc_name', myName); } catch (_e) {}
        meEl.textContent = 'You: ' + myName;
        setViewers(msg.viewers);
        clearMessages(); // fresh room (or reconnect) — avoid stale/duplicate history
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
      case 'delete':
        removeMessage(msg.id);
        break;
      case 'cleared':
        clearAllMessages();
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
      if (mine) div.appendChild(buildDeleteButton(msg.id));
      div.appendChild(buildReactBar(msg.id));
      // Flip the quick-react bar below the message when there isn't room above
      // (e.g. the topmost message), so it isn't clipped by the scroll container.
      div.addEventListener('mouseenter', () => {
        const m = div.getBoundingClientRect();
        const c = messagesEl.getBoundingClientRect();
        div.classList.toggle('react-below', (m.top - c.top) < 44);
      });
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

  // Delete-your-own-message button (× on hover of your own messages).
  function buildDeleteButton(id) {
    const btn = document.createElement('button');
    btn.className = 'del-btn';
    btn.type = 'button';
    btn.title = 'Delete message';
    btn.textContent = '×';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this message?')) return;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'delete', id }));
    });
    return btn;
  }

  function removeMessage(id) {
    const el = msgEls.get(id);
    if (el) { el.remove(); msgEls.delete(id); }
  }

  function clearAllMessages() {
    messagesEl.textContent = '';
    msgEls.clear();
    addSystem('Chat was cleared by the host.');
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
  startSessions();
})();
