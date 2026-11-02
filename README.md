# IPTV Player

Personal desktop IPTV player for macOS and Windows. Electron + React.

Plays your own Xtream Codes account or M3U playlist:

- Multiple lists (profiles): Xtream Codes (server, user, password) or M3U (URL or local file)
- Live TV by category, now/next EPG, catch-up for channels with archive
- Movies and series: categories, details, seasons and episodes
- Search across channels, movies and series
- Favorites per list
- Continue watching (resumes movies and episodes)
- Player: HLS (hls.js), MPEG-TS (mpegts.js) and MP4/WebM (native), with automatic fallback

## Player: fitting the picture to the screen

Hover over the video to show the toolbar (top right). The choice is remembered for every video.

| Control | Shortcut | What it does |
|---|---|---|
| ⤢ Original | `A` cycles | Whole picture, black bars where the aspect ratio differs |
| ⤢ Preencher | `A` | Fills the screen, crops the top and bottom (best for ultrawide 21:9) |
| ⤢ Esticar | `A` | Fills the screen by stretching the picture |
| − / % / + | `-` `+` `0` | Zoom from 100% to 200% in 5% steps; `0` resets |
| ⛶ | `F` or double-click | Fullscreen (keeps the fit mode) |

On a 21:9 monitor showing 16:9 video, "Esticar" distorts by about 31%. For a middle ground, use "Original" with zoom around 115–125%.

Everything stays on your machine (localStorage / IndexedDB). The app only talks to the server of the list you add.

## Requirements

- Node.js 22.12+ (or 24+, 26+)
- On a network with a corporate/antivirus TLS proxy, set `NODE_EXTRA_CA_CERTS` before `npm install`

## Development

```bash
npm install
npm run dev
```

## Build the installers

```bash
npm run dist:mac   # dist/IPTV Player-<version>-arm64.dmg and -x64 (Intel)
npm run dist:win   # dist/IPTV Player Setup <version>.exe and the portable .exe
npm run dist       # both
```

Builds are not signed with a paid certificate:

- **macOS**: on first open, right-click the app → Open → Open. Or: System Settings → Privacy & Security → Open Anyway.
- **Windows**: SmartScreen shows "Windows protected your PC" → More info → Run anyway.

## Limitations

The player runs on Chromium, which does not decode every format IPTV servers send:

- MKV containers, HEVC/H.265 video and AC3/E-AC3/DTS audio may not play. The player shows a message when that happens.
- For live channels, the app requests `.m3u8` (HLS) and falls back to `.ts` when the server does not provide HLS.

## Structure

```
src/main/index.js          Electron window, menu, CORS headers for IPTV servers
src/preload/index.js       Minimal bridge (platform only)
src/renderer/src/
  lib/xtream.js            Xtream Codes API client (player_api.php)
  lib/m3u.js               M3U parser + adapter with the same interface
  lib/source.js            Picks the backend per profile, caches it
  lib/store.js             Profiles, favorites, progress (localStorage + IndexedDB)
  lib/playback.js          Full-window player state + progress saving
  components/Player.jsx    hls.js / mpegts.js / native video
  pages/                   Profiles, login, home, live, catalog, details, search
```
