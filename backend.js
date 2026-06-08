// Where the GitHub Pages frontend finds the chat/reactions/stream backend.
// This points at the Mac running `node server.js`, exposed via the Cloudflare
// tunnel. If the tunnel is restarted and the URL changes, update this one line
// and re-run the deploy (npm run deploy / git subtree push to gh-pages).
//
// When the page is served by the Mac itself (localhost or the tunnel directly),
// leave this empty to use the same origin.
window.WWDC_BACKEND = "https://infant-phillips-laptop-claimed.trycloudflare.com";
