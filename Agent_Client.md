# Agent Client — Engineering Handover

> Audience: any engineer/agent picking this up. This captures the **current architecture,
> the major in-progress change (Telegram MTProto user-account auth), how everything wires
> together, how to build/run/deploy it, and the known gotchas**. Read this top-to-bottom
> once before touching code.
>
> Companion docs: `PRD.md`, `TECH_SPEC.md`, `USER_FLOW.md` (product/spec). This file is the
> *as-built* engineering truth and supersedes them where they differ.
>
> Branch: `feat/biz-230-mockup-setup`. **Status: a large body of work is UNCOMMITTED** (~54
> changed/added files) — see §11 before committing.

---

## 1. What this is

A **working Telegram-compatible chat client** (not a mockup) plus a **relay server**.

- `mobile/` — Expo SDK 51 / RN 0.74 app (Expo Router, Zustand, layered architecture).
- `relay/` — Node (ESM, tsx) / Fastify / better-sqlite3 server we own.

**The product:** chat with an AI agent that lives behind Telegram. Originally it talked to
Telegram via a **bot token (Bot API)**. That has a fatal UX flaw: a bot token can only act
*as the bot*, so messages the user typed went out *as the bot* ("the agent is the speaker").

**The big change (this work):** switch authentication to a **Telegram user account via
MTProto (GramJS)**, hosted on the relay, so the human is the real sender — you talk *to* a
bot as yourself, and its replies come back as the agent. See §4.

Current concrete setup in use:
- Relay deployed behind a **Cloudflare named tunnel**: `https://telegram-relay.2prostream.com`
  → `http://localhost:8787` (the relay).
- App configured with `expo.extra.relayBase = https://telegram-relay.2prostream.com`.
- Verified end-to-end on a real device (Samsung **SM-S937N**, Android 16) and the
  `Pixel_10_Pro` emulator: phone→code→(2FA) login, add bot by @username, send/receive,
  markdown/code-block rendering, link previews, cross-client sync.

---

## 2. Repository layout

```
AgentClient/
├─ Agent_Client.md          ← this file
├─ PRD.md / TECH_SPEC.md / USER_FLOW.md
├─ mobile/                  ← Expo/RN app
│  ├─ app/                  ← Expo Router screens (file-based routing)
│  │  ├─ index.tsx          ← splash → routes by auth status
│  │  ├─ _layout.tsx        ← Stack + push listeners
│  │  ├─ (auth)/            ← phone.tsx, code.tsx, twofa.tsx  (MTProto login)
│  │  └─ (main)/            ← buddies.tsx, chat/[id].tsx, add-buddy/*, settings/*
│  ├─ src/
│  │  ├─ domain/            ← pure TS: entities.ts, markdown/ (parser+types)
│  │  ├─ application/stores ← zustand: auth, buddies, chat, notifications, trace, addBuddyDraft
│  │  ├─ infrastructure/
│  │  │  ├─ api/            ← relayClient.ts, telegramBotApi.ts (types), traceStream.ts
│  │  │  ├─ receive/        ← ReceiveSource.ts (RelayPullSource | NullReceiveSource)
│  │  │  ├─ storage/        ← secureStore.ts (SecureKeys), kv.ts (KvKeys)
│  │  │  ├─ notifications/  ← pushClient.ts (expo-notifications)
│  │  │  └─ config.ts       ← reads expo.extra (gateway/apiBase/relayBase)
│  │  ├─ ui/                ← markdown/Markdown.tsx (renderer), components/TracePanel
│  │  ├─ components/        ← ChatBubble, ChatInputBar, BuddyRow, Avatar, Badge
│  │  └─ mock/seed.ts       ← seed buddies + canned replies (offline mock buddies)
│  ├─ android/ ios/         ← prebuilt native projects (bare workflow)
│  ├─ app.json              ← expo config (extra.relayBase lives here)
│  └─ e2e/                  ← Maestro flows (+ android-setup.sh, vendor/ADBKeyboard.apk)
└─ relay/
   └─ src/  config crypto store types log  index  poller push  mtproto  smoke store.test mtproto.smoke
```

---

## 3. High-level architecture & message flow

```
┌─────────── mobile app ───────────┐        ┌──────────────── relay (Node) ─────────────┐
│ auth store (phone/code/2fa)       │  HTTPS │ Fastify routes (/auth/*, /peers/resolve,   │
│ buddies store (peers)             │ ─────► │  /send, /pull, /register, /media, /health) │
│ chat store (timeline, send/recv)  │        │ mtproto.ts: per-device GramJS TelegramClient│
│ ReceiveSource → RelayPullSource   │ ◄───── │   (logged in as the USER account)          │
│ Markdown renderer / ChatBubble    │  /pull │ store.ts (SQLite): user_sessions, peers,   │
└───────────────────────────────────┘        │   devices, subscriptions, updates          │
        │ Cloudflare tunnel (TLS)             │ push.ts (Expo), poller.ts (legacy bot path)│
        ▼                                     └───────────────┬────────────────────────────┘
  telegram-relay.2prostream.com                               │ MTProto (GramJS)
                                                               ▼
                                                        Telegram servers
```

**Send (app → bot, as the user):** app `chat.send` appends an optimistic `role:"user"`
message → `sendLive` → `relayClient.sendAs(peerId, text)` → `POST /send` → relay's GramJS
client `sendMessage(peer, text)` **as the user**. The relay returns the Telegram
`message_id`; the app rewrites the optimistic message id to `tg-{message_id}` so the echoed
copy (from the receive handler) dedups.

**Receive (bot → app, and cross-client):** relay's GramJS `NewMessage({})` handler (both
directions) fires → it converts Telegram **entities → markdown** and **webpage media →
link preview**, buffers a `TgUpdate` into the `updates` table keyed by `message_id`, and (for
incoming only) sends an Expo push. The app's `RelayPullSource` polls `GET /pull?...&since=`
every 3s while a chat is open (and on push), and `chat.ingestUpdates` appends messages —
`role:"agent"` for incoming, `role:"user"` for `outgoing` (messages the user sent from any
client → **cross-client sync**).

---

## 4. The core change: Telegram MTProto user-account auth

**Why:** Bot API (bot token) can only act as the bot. To send *as the human* to a bot, you
need the **MTProto Client API with a user account** (phone login), not a bot token.

**Where it runs:** on the **relay** (GramJS in Node), NOT on-device. Decided because GramJS
is reliable in Node, reuses the relay's existing crypto/store/push, and supports background
receive. The user's encrypted session lives on the relay (which they own → acceptable).

**Prerequisite:** `api_id` / `api_hash` from https://my.telegram.org/apps, provided to the
relay as env (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`).

**Login flow (HTTP-driven, relay holds the session):**
1. App `POST /auth/start {deviceId, phone}` → relay `client.sendCode()` → code sent to the
   user's Telegram app. On first call the relay also mints the device's bearer `deviceSecret`.
2. App `POST /auth/code {deviceId, code}` → `Api.auth.SignIn`. If 2FA → `{needs2fa:true}`.
3. App `POST /auth/2fa {deviceId, password}` → SRP via `client.signInWithPassword`.
4. On success the relay saves `client.session.save()` **encrypted** (`user_sessions`) and
   keeps the live client in memory; on boot `reconnectAll()` rebuilds clients from sessions.

The **mobile** auth store mirrors this with statuses `loading|onboarding|code|2fa|ready`.
It persists only `tgUserId`/`phone` (display) + the relay `deviceSecret`; the actual Telegram
session never leaves the relay.

---

## 5. Relay deep-dive (`relay/src`)

| File | Role |
|---|---|
| `index.ts` | Fastify HTTP server + all routes + boot (`reconcileLoops` + `mtproto.reconnectAll`). |
| `mtproto.ts` | **GramJS manager**: login (start/confirmCode/confirm2fa), `sendAs`, `resolvePeer`, `NewMessage` receiver (entity→md, preview, buffer, push), `downloadWebpagePhoto`, `reconnectAll`, `logout`. |
| `store.ts` | SQLite. Tables + ops (see below). |
| `crypto.ts` | AES-256-GCM `encrypt/decrypt` (bot tokens AND MTProto sessions) + device-secret hashing. |
| `types.ts` | `TgMessage`/`TgUpdate` (+ `outgoing`, `preview`), `LinkPreview`, request bodies. |
| `config.ts` | env: `PORT` (8787), `RELAY_MASTER_KEY`, `TELEGRAM_API_ID/HASH`, `mtprotoEnabled`. |
| `poller.ts`/`push.ts` | Legacy **bot-token** long-poll path + Expo push fan-out (still present; MTProto peers reuse `push.ts`). |
| `store.test.ts` | `npm test` — deterministic unit checks (crypto, cursor, sessions, peers). |
| `smoke.ts` / `mtproto.smoke.ts` | live smoke tests (need a token / phone). |

**SQLite schema (store.ts):**
- `devices(device_id PK, device_secret_hash, expo_push_token, platform, …)`
- `user_sessions(device_id PK, enc_session, tg_user_id, phone, status[pending|active|revoked], …)` — one Telegram account per device.
- `peers(device_id, peer_id, username, title, access_hash, local_seq, PK(device_id,peer_id))` — resolved bots/chats. `local_seq` is now **unused** (we switched cursors to message_id; see below) but kept.
- `subscriptions(device_id, bot_id, buddy_id, PK(device_id,bot_id))` — device↔peer binding; drives `/pull` auth + push targets. `bot_id` == peer id for MTProto.
- `updates(bot_id, update_id, payload_json, received_at, PK(bot_id,update_id))` — buffered messages; `update_id == Telegram message_id`.

**HTTP endpoints (index.ts):**
| Method/Path | Purpose |
|---|---|
| `POST /auth/start` | phone → request code (mints deviceSecret on first call) |
| `POST /auth/code` | submit code → `{signedIn}` or `{needs2fa}` |
| `POST /auth/2fa` | submit cloud password |
| `POST /auth/logout` | `auth.LogOut` + revoke session |
| `GET /auth/status?deviceId=` | `{status, connected, tgUserId, phone}` (drives the app's "connected" dot) |
| `POST /peers/resolve {username}` | resolve @username → `{peerId, username, title}`; caches access_hash |
| `POST /send {peerId, text}` | send as the user → `{messageId}` |
| `GET /pull?deviceId&botId&since` | buffered updates with `update_id >= since` (Telegram getUpdates semantics) |
| `POST /register` / `POST /unregister` | device + subscription registration (token-less for MTProto peers) |
| `GET /media?deviceId&peer&msg` | proxy a message's webpage-preview photo (Telegram photos aren't public URLs). Unauthenticated by design. |
| `GET /health` | snapshot (devices, sessions, loops) |

**Critical relay invariants / fixes baked in:**
- **Entity → markdown** (`entitiesToMarkdown` in mtproto.ts): Telegram sends formatting as
  message *entities* (UTF-16 offsets), not literal markdown. Without converting, code blocks
  flatten into a plain paragraph. We rebuild ```` ``` ````/`` ` ``/`**`/`_`/`~~`/`[](url)`/`> `.
- **Ordering = `message_id`**: `update_id` is set to the Telegram `message_id` (monotonic per
  chat). `/pull` orders by it, so order is correct even if GramJS events arrive out of order.
- **`/pull` is `update_id >= since`** (inclusive). The app sends `since = lastSeen + 1`
  (Telegram convention). Earlier `> since` dropped the boundary message intermittently. The
  app dedups by message id so inclusive never duplicates.
- **push.ts must NOT delete a device for an empty/invalid Expo token** — empty = pull-only
  (no push granted / simulator). Only a real `DeviceNotRegistered` receipt prunes. (A prior
  bug deleted the device on first receive → broke `/pull`.)
- **Cross-client sync**: receiver uses `NewMessage({})` (both directions); private-chat peer
  is always `msg.chatId`; `msg.out` → `message.outgoing = true`; push skipped for outgoing.

---

## 6. Mobile deep-dive

**Auth (`stores/auth.ts`, `app/(auth)/*`, `app/index.tsx`):** phone → code → 2fa via
`relayClient`. `connected` + `refreshStatus()` reflect `/auth/status`. Splash routes by
status. `SecureKeys`: `tgUserId`, `phone`, `deviceId`, `deviceSecret` (no more `botToken`/`userId`).

**Peers (`stores/buddies.ts`, `app/(main)/add-buddy/*`):** a "buddy" is a resolved peer
(bot) added by **@username** (`preview` → `relayClient.resolvePeer`; `add` → register a
token-less subscription). `botId == peerId == chatId`. `markRead(id)` clears the unread badge.
Live buddies show relay-session connectivity; mock seed buddies keep a static flag.

**Chat (`stores/chat.ts`):**
- `send` → optimistic `role:"user"` → `sendLive` → `relayClient.sendAs`; reconciles id to
  `tg-{messageId}`.
- `ingestUpdates` → appends pulled updates; `role` from `outgoing`; attaches `preview`
  (prepends `config.relayBase` to the relay `/media` path); dedups by `tg-{message_id}`;
  advances the per-buddy offset (`update_id + 1`).
- Mock buddies (`live:false`) stream canned replies locally (unchanged).

**Receive (`infrastructure/receive/ReceiveSource.ts`):** `RelayPullSource` (when `relayBase`
set) polls `/pull` every 3s while a chat is open + `catchUp` on push. `NullReceiveSource`
otherwise (live receive requires the relay). The old direct-`getUpdates` poller is removed.

**Markdown (`ui/markdown/Markdown.tsx` + `domain/markdown/*`):** dependency-free GFM parser →
RN renderer. Code blocks render as a **Telegram-style card**: header (language + 복사 button
via `expo-clipboard`) over a horizontally-scrollable monospace body.

**ChatBubble (`components/ChatBubble.tsx`):** user right / agent left; equal narrow side
margins + wide bubbles (maxWidth 100%, row padding `space[3]`); renders `LinkPreview` card
(cover image + site/title/description/host, tappable) when `message.preview` exists.

**Chat screen (`app/(main)/chat/[id].tsx`) — scroll/read behavior:**
- **Pagination**: windowed `messages.slice(-visible)`, `visible` starts 20, `+20` when
  scrolled near top; `maintainVisibleContentPosition`, `initialNumToRender={visible}`.
- **Read tracking**: `onViewableItemsChanged` records the bottom-most on-screen message id;
  on leave it's persisted as `buddy.lastReadId`.
- **Restore on open**: scroll to the first **unread** message at the top (Telegram-style),
  else bottom. `scrollToIndex` needs measured rows → we render the full window
  (`initialNumToRender`) and delay the scroll ~250ms; `onScrollToIndexFailed` retries.
  (See §10 — this is the last area touched and is the most fragile.)
- Header shows a **green/red connection dot** (`success`/`error`) from session connectivity.

---

## 6b. File attachments (send)

Send-side attachments for: documents (text/docx/pptx/xlsx/pdf), photo/video (library),
camera capture, voice recording, and location.

- **Deps**: `expo-document-picker`, `expo-image-picker`, `expo-av`, `expo-location`, `expo-file-system`.
- **Pickers**: `mobile/src/infrastructure/attachments.ts` — `pickDocument`, `pickMedia`,
  `captureCamera`, `getLocationUrl`, `start/stop/cancelRecording`, `readBase64`. Returns a
  normalized `PickedAttachment {kind,uri,name,mime,size?,durationMs?}`.
- **Upload**: app base64-encodes the file and POSTs `/sendMedia {deviceId,peerId,kind,fileName,
  mime,caption?,dataBase64}` → `mtproto.sendMediaAs` → GramJS `client.sendFile` (CustomFile;
  `forceDocument` for documents, `voiceNote` for voice, `supportsStreaming` for video; mime is
  inferred from the filename extension). Fastify `bodyLimit` raised to 60 MB.
- **Location** = a Google Maps URL sent as a normal message (`[📍 내 위치 (지도)](…)`) → reuses
  `/send` + the link-preview card. No relay change for location.
- **Grouping (one bubble)**: staged items are bucketed on send to the fewest bubbles Telegram
  allows — photos/videos → one **album** (`/sendMediaGroup` → GramJS `sendFile` with a file
  array), documents → one group, voices individually, and **all locations combined into one
  text message**. Caption rides on the first group. `Message.attachments: Attachment[]` holds an
  album; `ChatBubble` renders a 2-col image grid for multi-image, else stacked chips.
- **Model/UI**: `Message.attachments[]` (`domain/entities.ts`); `chat.sendAttachments` (optimistic
  render → readBase64 → `/sendMedia` → reconcile id to `tg-{id}`); `ChatInputBar` has a ＋ menu
  (사진/동영상·카메라·파일·위치) + 🎙 record (tap start / tap stop-send / ✕ cancel);
  `ChatBubble` `AttachmentView` renders images inline and others as a tappable file chip.
- **Android perms** added manually to `AndroidManifest.xml` (CAMERA, RECORD_AUDIO,
  ACCESS_FINE/COARSE_LOCATION, READ_MEDIA_IMAGES/VIDEO) — bare project, no prebuild.
- **Not done**: rendering *received* media (files others send) needs a relay download proxy
  (like `/media`) — follow-up. Own-sent media shows optimistically; its outgoing echo is
  skipped by the receiver (empty text) so no dup. iOS `Info.plist` usage strings not yet added
  (Android-only testing).

## 6c. Receiving media + message UX (agent-comms)

- **Received media/files**: the relay receive handler classifies incoming media
  (`classifyMedia`: photo/video/voice/audio/document) and adds a `media` descriptor
  (`{kind,name,mime,size,url}`) to the buffered update; bytes are fetched via the generalized
  `/media` proxy (`mtproto.downloadMessageMedia` → `client.downloadMedia`, dynamic
  Content-Type). The app maps `m.media` → `attachments[]` (uri = `relayBase + /media?…`), so
  `ChatBubble` renders images inline and other files as tappable chips. This also yields
  **cross-client media sync** (own sends dedupe by `tg-{message_id}`).
- **Message actions** (long-press any bubble): **복사** (expo-clipboard), **답장** (sets a reply
  quote bar above the composer; sends with Telegram `reply_to` via `sendAs(…, replyTo)` and
  shows the quote on the bubble via `Message.replyTo`), **재전송** (failed user messages).
- **"입력 중" indicator**: `chat.awaiting[buddyId]` — set after a live send, cleared when an
  incoming agent message arrives (120s safety timeout). Shown above the composer.
- **NOT done — true token streaming via message edits**: agents that stream by *editing* a
  message aren't reflected yet. The relay only handles `NewMessage`; delivering `edited_message`
  needs decoupling the `/pull` cursor from `message_id` (use a monotonic per-peer seq for the
  cursor + order the app timeline by message_id/createdAt) — a deliberate redesign to avoid
  regressing the ordering/missing-message fixes (§5). Deferred.

## 7. Configuration & secrets

**Relay env** (`relay/.env`, git-ignored; `.env.example` committed; loaded via
`node --env-file-if-exists=.env`):
```
TELEGRAM_API_ID=…        # my.telegram.org/apps
TELEGRAM_API_HASH=…
RELAY_MASTER_KEY=…       # openssl rand -hex 32 ; encrypts sessions+tokens at rest
# PORT/HOST/RELAY_DB optional
```
If `RELAY_MASTER_KEY` is unset, a dev key is used (loud warning) — fine for local, but
sessions saved under the dev key won't decrypt after you set a real key (forces re-login).

**App** (`mobile/app.json` → `expo.extra`): `relayBase` MUST point at the relay
(`https://telegram-relay.2prostream.com`). With HTTPS (Cloudflare), no Android cleartext / iOS
ATS config is needed. `gateway`/`apiBase` are legacy (unused in the MTProto path).

**Cloudflare tunnel**: token-based (`cloudflared tunnel run --token …`), so the **local
`~/.cloudflared/config.yaml` is ignored** — public hostnames are configured in the **Zero
Trust dashboard** (Networks → Tunnels → Public Hostname). The route must be
`telegram-relay.2prostream.com → HTTP localhost:8787` (HTTP, not HTTPS — the relay is plain
HTTP; HTTPS there causes a 502).

---

## 8. Build / run / deploy

**Relay:**
```
cd relay && npm install
npm start          # node --env-file-if-exists=.env --import tsx src/index.ts
# expect log: "mtproto enabled (user-account path active)" + "relay listening on …:8787"
```
For permanent use run it under a process manager (the mac-mini host). cloudflared must be up
and routing to localhost:8787 (see §7).

**Mobile (Android release APK — standalone, no Metro):**
```
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"   # JBR 21
cd mobile/android && ./gradlew :app:assembleRelease
adb -s <device> install -r app/build/outputs/apk/release/app-release.apk
```
- Release is signed with the debug key → installs on devices/emulators directly.
- First build ~19 min (NDK); incremental ~12–20s.
- `applicationId` = `dev.simplist.agentclient.mockup`.
- `~/Desktop/AgentClient.apk` is kept as the latest copy for sideloading to the phone.

---

## 9. Testing

- **Relay unit**: `cd relay && npm test` (currently 20/20) — crypto round-trip, session/peer
  ops, `nextPeerSeq`, cursor inclusivity. No network.
- **Relay live smoke**: `npm run smoke:mtproto -- <+phone> <botUsername>` (needs api creds +
  interactive code/2FA on stdin) — proves login+send+receive+buffer end-to-end without a device.
- **Typecheck**: `npx tsc --noEmit` in both `relay/` and `mobile/` (both clean as of handover).
- **e2e (Maestro, `mobile/e2e/`)**: ⚠️ **currently broken by the auth change** — the login
  subflow uses the removed user-id onboarding, and MTProto login can't be automated (real
  Telegram code). Needs redesign. The flow files + `android-setup.sh` (ADBKeyboard for Unicode
  input + no-keyboard-occlusion) remain from the iOS-verified era.

---

## 10. Known issues, gotchas, TODO

**Gotchas that will bite you (all learned the hard way):**
- **Gradle build cache hides `app.json` `extra` changes.** `app.json` isn't a tracked input
  of `createBundleReleaseJsAndAssets`, so changing `relayBase` etc. is restored from cache and
  NOT re-embedded. Fix: `./gradlew clean :app:assembleRelease`. Verify with
  `unzip -p app-release.apk assets/app.config | grep relayBase` (it lives in the expo-constants
  manifest, NOT in `index.android.bundle`).
- **`adb install` hangs if the phone screen is locked/off** (Samsung). Keep the screen awake
  during install. USB needs a data mode (MTP) and the RSA "Allow USB debugging" prompt accepted.
- **`tsc` cwd**: running two `npx tsc` in one shell line keeps the first cwd — run mobile and
  relay typechecks in separate commands.
- **Relay process lifetime**: launch `npm start` as its own long-lived process; nesting it in
  a wrapper that exits kills it.

**Open / fragile:**
- **Chat scroll restore (#2)** is the last thing touched and NOT yet re-verified after the
  latest fix (`initialNumToRender={visible}` + 250ms delayed `scrollToIndex`, first-unread at
  top). Root cause was `scrollToIndex` firing before rows were measured (`averageItemLength=0`
  → landed at top). If still flaky, the robust path is an **inverted FlatList** (deterministic
  bottom start + reliable scrollToIndex for recent items) — was considered but not done to
  avoid the inverted `viewPosition` ambiguity.
- **Link-preview image** depends on the relay `/media` proxy downloading the Telegram photo
  on demand (no caching yet) — could be slow/repeated; add caching if needed.
- **e2e suite** needs redesign for MTProto auth (can't automate the login code).
- **History backfill**: only *new* messages are synced; past Telegram history isn't fetched
  when adding a peer. Consider `getMessages` backfill.
- **Single account per device** is assumed (`user_sessions` PK = device_id).
- **Telegram ToS / FLOOD_WAIT**: automating a user account from a server has ban risk; the
  relay surfaces `FLOOD_WAIT` as `retryAfter`. Keep volume human-paced.

---

## 11. Uncommitted state & how to continue

Everything described here is **uncommitted** on `feat/biz-230-mockup-setup` (~54 files:
relay MTProto layer, mobile auth/peer/chat rework, markdown/link-preview/scroll UI, e2e
README/scripts, `relay/.env.example`, vendored `ADBKeyboard.apk`). Before committing:
- Don't commit `relay/.env` (git-ignored) or real `api_hash`.
- Re-verify the scroll-restore fix on device (§10) — or switch to inverted FlatList.
- Decide on the e2e redesign.

**To resume the live system:** ensure (1) `relay/.env` has the 3 vars, (2) `npm start` in
`relay/` is running, (3) cloudflared routes `telegram-relay.2prostream.com → http://localhost:8787`,
(4) the installed app's `app.json` `relayBase` matches. Confirm with
`curl https://telegram-relay.2prostream.com/health` → `{"ok":true,…,"sessions":[{… "status":"active"}]}`.

**Background context worth knowing:** the original app was a Telegram **bot-token** client
(see git history before this work and `TECH_SPEC.md`). The agent's persistent project memory
(`~/.claude/projects/-Users-simplist-Dev-AgentClient/memory/`) has condensed notes —
especially `project_mtproto_auth.md` (this change) and `feedback_rn_maestro_testing.md`
(RN/Android build & test gotchas).
