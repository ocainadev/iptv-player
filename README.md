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

## Android (phone and TV)

The same React app runs on Android through Capacitor, with video decoded natively by ExoPlayer (HEVC, MKV, MPEG-TS, HLS). The app detects Android TV and switches to the remote-control interface.

Requirements: JDK 21 (Gradle 8 does not run on JDK 25+) and the Android SDK.

```bash
export JAVA_HOME=/path/to/jdk-21
npm run android:apk   # dist/IPTV-Player-<version>.apk, signed
```

The version comes from `package.json`. Signing uses `android/keystore.properties` (git-ignored), which points to a keystore kept **outside** the repository. Back up that keystore and its passwords: an APK signed with a different key cannot update an installed one, and Android refuses it.

Without `keystore.properties` the release build is unsigned. To install on a TV, use `adb install` or send the APK to the device and open it.

**Updates.** The app checks GitHub for a newer release a few seconds after it starts and every 6 hours, and starts downloading it right away. A notice at the bottom of the screen then offers to install:

- **Windows (installer):** downloads in the background and installs on restart (or by itself when the app is closed).
- **macOS:** downloads the `.dmg` and swaps the app in place, then reopens it. If the app's folder is not writable, it opens the `.dmg` instead.
- **Android / Android TV:** downloads the APK and opens the system installer. Android always asks for a confirmation, and the first time the user must allow "install unknown apps" for IPTV Player.
- **Windows portable:** only shows a link to the download.

To release: bump `version` in `package.json`, run the desktop builds and `npm run android:apk`, then attach the `.apk` to the GitHub release (tag = version). The app's "Verificar atualizações" button reads the latest release and opens the `.apk` download.

## Limitations

On desktop the player runs on Chromium, which does not decode every format IPTV servers send:

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
