# WWDC Live

A live TV-style watch party for the WWDC keynote: the stream plays automatically
on load (no playback controls), with full-screen, a live chat, and floating emoji
reactions.

## Architecture

- **Frontend** (`public/`) — static HTML/CSS/JS, plays HLS via [hls.js](https://github.com/video-dev/hls.js)
  (native HLS on Safari). Hosted on **GitHub Pages**.
- **Backend** (`server.js`) — tiny Node + Express + `ws` server providing the chat /
  reactions WebSocket and a `/api/config` endpoint (the current stream URL). Runs on
  a Mac and is exposed publicly via a Cloudflare tunnel.

The Pages frontend talks to the backend over the tunnel; `public/backend.js` holds
that backend URL (one line to update if the tunnel restarts).

## Run the backend locally

```bash
npm install
node server.js          # http://localhost:8080
# expose it:  cloudflared tunnel --url http://localhost:8080
```

## Set / swap the stream

Put the HLS (`.m3u8`) URL into `config.json` → `streamUrl`. Viewers auto-flip from the
standby screen to the live stream within ~10s; no refresh needed. Empty string shows
the "Going live soon" standby screen.

## Deploy the frontend to GitHub Pages

```bash
npm run deploy          # pushes public/ to the gh-pages branch
```
