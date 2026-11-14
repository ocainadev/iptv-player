# Telara

Personal player for your own Xtream Codes and M3U playlists, on macOS, Windows, Android and Android TV. It ships with no channels or content. Electron + React.

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
npm run dist:mac   # dist/Telara-<version>-arm64.dmg and -x64 (Intel)
npm run dist:win   # dist/Telara-Setup-<version>.exe and Telara-Portable-<version>.exe
npm run dist       # both
```

Builds are not signed with a paid certificate:

- **macOS**: on first open, right-click the app → Open → Open. Or: System Settings → Privacy & Security → Open Anyway.
- **Windows**: SmartScreen shows "Windows protected your PC" → More info → Run anyway.

## Linux

Linux builds are no longer published in the releases. The app still builds and runs on Linux if you want it:

```bash
npm run dist:linux   # dist/Telara-<version>-x86_64.AppImage, -amd64.deb, -arm64.deb
```

- **AppImage** (x86_64): `chmod +x Telara-*.AppImage && ./Telara-*.AppImage`. On Ubuntu 23.10+ the AppArmor restriction on user namespaces can stop the Chromium sandbox: run it with `--no-sandbox` if it refuses to start.
- **.deb** (Debian, Ubuntu; x86_64 and ARM64): `sudo apt install ./Telara-*.deb`.
- Without a published release there is nothing to update from: rebuild from a newer source to update.
- Chromium on Linux decodes H.264/AAC and HLS, but HEVC depends on hardware decoding (VA-API) and AC3 audio does not play, as on the other desktop builds.

## Android (phone and TV)

The same React app runs on Android through Capacitor, with video decoded natively by ExoPlayer (HEVC, MKV, MPEG-TS, HLS). The app detects Android TV and switches to the remote-control interface.

Requirements: JDK 21 (Gradle 8 does not run on JDK 25+) and the Android SDK.

```bash
export JAVA_HOME=/path/to/jdk-21
npm run android:apk   # dist/Telara-<version>.apk, signed
```

The version comes from `package.json`. Signing uses `android/keystore.properties` (git-ignored), which points to a keystore kept **outside** the repository. Back up that keystore and its passwords: an APK signed with a different key cannot update an installed one, and Android refuses it.

Without `keystore.properties` the release build is unsigned. To install on a TV, use `adb install` or send the APK to the device and open it.

**Updates.** The app checks GitHub for a newer release a few seconds after it starts and every 6 hours, and starts downloading it right away. A notice at the bottom of the screen then offers to install:

- **Windows (installer):** downloads in the background and installs on restart (or by itself when the app is closed).
- **macOS:** downloads the `.dmg` and swaps the app in place, then reopens it. If the app's folder is not writable, it opens the `.dmg` instead.
- **Android / Android TV:** downloads the APK and opens the system installer. Android always asks for a confirmation, and the first time the user must allow "install unknown apps" for Telara.
- **Windows portable:** only shows a link to the download.

To release: bump `version` in `package.json`, run the desktop builds and `npm run android:apk`, then attach the `.apk` to the GitHub release (tag = version). The app's "Verificar atualizações" button reads the latest release and opens the `.apk` download.

## Syncing progress between devices

"Continue watching" and favorites can follow a profile across devices (for example the same
list on the TV box and on the phone). Nothing else is shared: the list, user and password are
registered on each device, and the data that does travel is encrypted on the device first.

There is no shared server and no account. Each person runs their **own** tiny sync service on a
free Cloudflare account (the code is in `worker/`). It stores one opaque, encrypted blob per pairing
code and cannot read it. The address and access key of your service are typed once per device and
never stored in the app's code or in this repository.

### 1. Create your sync service (once, about 5 minutes)

You need Node.js and a free Cloudflare account (https://dash.cloudflare.com/sign-up, no card required).

```bash
cd worker
npx wrangler login                      # opens the browser to authorize your account
npx wrangler kv namespace create SYNC   # prints an id: paste it into worker/wrangler.toml
                                        # (replace PASTE_THE_NAMESPACE_ID_HERE)
npx wrangler deploy                     # prints your address, like https://iptv-player-sync.<you>.workers.dev
```

Note the address `deploy` prints. If it asks you to register a `workers.dev` subdomain, accept (free).

Create an access key so only your devices can use the service (strongly recommended):

```bash
openssl rand -hex 8                     # prints your key, for example 0123456789abcdef; save it
npx wrangler secret put ACCESS_TOKEN    # paste the key when asked
npx wrangler deploy
```

Without a key, anyone who finds the address could use up your free quota (they still could not read your data).

### 2. Link your devices

1. On the first device open **Sincronizar** on the profile card, type the **address** and the **access key**, and
   tap **Ativar sincronização**.
2. To add another device, tap **Gerar código para outro aparelho** on a linked one: it shows 8 digits, valid for
   5 minutes and usable once.
3. On the other device open **Sincronizar** → **Tenho um código**, type the same **address** and **key** (once per
   device) and the 8 digits.

The 8 digits only carry the real long secret across; they are not the encryption key.

### Notes

- Playback progress is pushed at most every 2 minutes and when the player closes (the free KV tier
  allows about 1,000 writes per day); other devices pull when the app opens, returns to the
  foreground and every 10 minutes.
- When two devices change the same item, the most recent change wins. Removing a favorite or
  finishing a movie propagates too.
- Movies and episodes are matched by their id in the list, so the devices must use the same provider
  (same Xtream server or the same M3U list).
- Anyone who both knows the pairing digits and uses them within the 5-minute window could join the profile, so
  only generate the code when the other device is ready. Disconnecting a device only unlinks it.
- To change the key: `npx wrangler secret put ACCESS_TOKEN` again, then type the new key on each device.
- To remove everything: `npx wrangler delete` in `worker/` and delete the `SYNC` namespace in the Cloudflare dashboard.
- Check a deployed service: `node --import ./test/register.mjs test/live-check.mjs 'https://<address>#<key>'`
  (cleans up after itself). Tests: `npm run test:sync` (worker and client against an in-memory store).

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
