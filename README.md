# ♥ AO3 Chapter Kudos

Let readers leave kudos on **individual chapters** of your AO3 works — shared counts, visible to everyone.

> **Open source · Self-hosted · Decentralised · Works on mobile**

---

## How it works

```
Writer                           Reader (desktop)      Reader (mobile)
──────                           ────────────────      ───────────────
Deploy your own                  Install extension  OR  Save bookmarklet
Cloudflare Worker                (automatic)            (one tap per session)
(free, 5 minutes)
                                 Both work on any AO3 work with the skin applied.
Add one line to your             Counts are shared — everyone sees the same numbers.
AO3 Work Skin
```

---

## Reader Install

### Option A — Browser Extension (desktop, automatic)

- **Chrome / Edge**: [Install from Chrome Web Store](#)
- **Firefox**: [Install from Firefox Add-ons](#)

Buttons appear automatically on any work with the Chapter Kudos skin. No configuration needed.

### Option B — Bookmarklet (all devices including mobile)

Visit your writer's bookmarklet install page:

```
https://YOUR-WORKER.workers.dev/bookmarklet-install
```

Platform-specific instructions with screenshots are on that page for:
- Desktop (Chrome, Firefox) — drag to bookmarks bar
- iPhone / iPad (Safari) — bookmark + edit URL
- Android (Chrome) — bookmark + edit URL

---

## Writer Setup (~5 minutes)

### 1. Create a free Cloudflare account
[cloudflare.com](https://cloudflare.com) — no credit card needed.

### 2. Deploy your Worker

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_USERNAME/ao3-chapter-kudos)

This creates your Worker and KV namespace automatically. You'll get a URL like:
```
https://ao3-chapter-kudos.YOUR-NAME.workers.dev
```

### 3. Set your secret key
Cloudflare dashboard → Workers → your Worker → **Settings → Variables and Secrets**

Add: `WRITER_SECRET` = anything you'll remember (keep it private)

### 4. Add your Work Skin
[Create a new Work Skin on AO3](https://archiveofourown.org/skins/new?skin_type=WorkSkin) and paste:

```css
:root {
  --ck-endpoint: "https://ao3-chapter-kudos.YOUR-NAME.workers.dev";
}
```
replace **YOUR-NAME** with your actual filler at cloudfare.
Give the new workskin a title of "Chapter Kudos".

### 5. Apply skin to your works
Edit Work → Custom Skin → select "Chapter Kudos" → save.

### 6. Share the bookmarklet install page with readers
Link readers to:
```
https://ao3-chapter-kudos.YOUR-NAME.workers.dev/bookmarklet-install
```

---

## Your Dashboard

Visit your Worker URL to see kudos per chapter, a bar chart, and drop-off between chapters:

```
https://ao3-chapter-kudos.YOUR-NAME.workers.dev
```

Enter your Work ID and `WRITER_SECRET` to log in.

---

## FAQ

**Do readers need an AO3 account?**
No. Logged-in readers get account-based deduplication (one kudos per account). Logged-out readers are tracked by a device ID stored locally.

**Will this work on my phone?**
Yes — use the bookmarklet. The extension is desktop-only.

**What data is stored?**
Your Cloudflare KV stores chapter counts and hashed voter IDs only. No usernames, no reading history.

**Can I use this on all my works?**
Yes — one Worker handles unlimited works. Apply the same skin to as many as you like.

**What if I stop using it?**
Delete your Cloudflare Worker and all data is gone. No vendor holds your data.

---

## Project Structure

```
ao3-chapter-kudos/
├── worker/
│   ├── worker.js              ← Cloudflare Worker (all endpoints)
│   ├── kudos-core.js          ← Shared logic (extension + bookmarklet)
│   ├── storage-adapters.js    ← chrome.storage / localStorage adapters
│   ├── bookmarklet-loader.js  ← Entry point loaded by the bookmarklet
│   ├── dashboard.html         ← Writer dashboard UI
│   ├── install.html           ← Reader bookmarklet install guide
│   └── wrangler.toml          ← Deployment config
└── extension/
    ├── manifest.json          ← Chrome/Firefox MV3 manifest
    ├── content.js             ← Extension entry point (thin wrapper)
    ├── kudos-core.js          ← Shared core (copy of worker/kudos-core.js)
    ├── storage-adapters.js    ← Adapters (copy of worker/storage-adapters.js)
    ├── content.css            ← Injected styles
    ├── popup.html             ← Extension popup (reader history)
    └── icons/                 ← icon16.png, icon48.png, icon128.png
```

> **Note on the shared files:** `kudos-core.js` and `storage-adapters.js` live in
> `worker/` (served as static JS) and are **copied** into `extension/` for the
> extension bundle. Keep them in sync when making changes — or set up a build
> step to copy automatically.

---

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/kudos/:workId` | — | All chapter counts |
| POST | `/kudos/:workId/:chapterId` | `X-Username-Hash` header | Increment count |
| GET | `/dashboard/:workId?key=SECRET` | Writer secret | Analytics data |
| GET | `/` | — | Writer dashboard UI |
| GET | `/bookmarklet-install` | — | Reader install guide |
| GET | `/bookmarklet.js` | — | Bookmarklet loader script |
| GET | `/kudos-core.js` | — | Shared core script |
| GET | `/storage-adapters.js` | — | Storage adapter script |

---

## Development

```bash
# Worker (local dev)
cd worker
npm install -g wrangler
wrangler dev

# Extension (load unpacked)
# Chrome: chrome://extensions → Developer mode → Load unpacked → select /extension
# Firefox: about:debugging → This Firefox → Load Temporary Add-on → select manifest.json
```

## Contributing
PRs welcome. Open an issue first for significant changes.

## Licence
MIT
