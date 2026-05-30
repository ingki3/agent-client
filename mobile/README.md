# Agent Client (mobile)

Telegram-protocol-compatible communication app for talking to agents (bots), built from
[PRD.md](../PRD.md) · [TECH_SPEC.md](../TECH_SPEC.md) · [USER_FLOW.md](../USER_FLOW.md).

Expo (SDK 51) · Expo Router · Zustand · TypeScript (strict). iOS / Android / web.

## Run

```bash
cd mobile
npm install
npm run ios      # or: npm run android / npm run web
npm run typecheck
```

### Standalone install (no Metro)

A Release build embeds the JS bundle, so the app runs without the dev server — open it
anytime from the simulator/device home screen.

```bash
cd mobile
npx expo run:ios --configuration Release   # builds, installs, launches (no Metro needed)
```

> Source changes are **not** picked up by an already-installed Release app — rerun the
> command above to rebuild. Routing/store/native changes especially need a full rebuild.

## Onboarding (single user — no login)

No phone/OTP. On first launch the user enters their **Telegram user id (= chat_id)** once
(`app/(auth)/userid.tsx`); it is stored in SecureStore and becomes each buddy's default
conversation address, so sending works immediately without first messaging the bot.
"초기화" in settings wipes the user id + all tokens/cache and returns to onboarding.

(Find your numeric id by messaging `@userinfobot` on Telegram.)

## What works

- **Onboarding** — one-time user id entry → friends list. Auto-enters on relaunch.
- **Add buddy** — bot token → real `getMe` validation + preview → SecureStore. Dedupes
  by bot id. (`chatId` defaults to the session user id; still overridable by a learned
  incoming update.)
- **Friends list** — list, FAB add, long-press → delete.
- **Chat** — send/receive, message status, **streaming render**, **GFM markdown**
  (headings, bold/italic/strike, code, lists, checkboxes, tables, blockquote, links, hr),
  Stop control, failed-message retry.
- **Trace** — thinking / tool_call / tool_result panel, live during stream, raw JSON with
  sensitive-arg masking. Hidden for standard bots (fallback).
- **Settings** — user id, notifications toggle, info/licenses, reset.

## Telegram protocol

Every Bot API call goes to `{gateway}/bot{token}/{method}` (Telegram standard):
`getMe`, `sendMessage`, `editMessageText`, `getUpdates` (long-poll), `sendChatAction`.

- **Default gateway** = `https://api.telegram.org` → the app talks to **real Telegram bots**.
- **Custom gateway / extensions** — `app.json` `expo.extra`:
  - `gateway` — Bot API base (Hermes/agent gateway, etc.).
  - `apiBase` — optional gateway extension (SSE trace + delta stream).
  - `relayBase` — optional push relay (see below). When set, the app stops polling
    Telegram directly and pulls from the relay; when null, foreground-only direct polling.

Mock seed buddies (no token) demonstrate streaming + markdown + trace without a backend.

## Background push (optional)

By default messages arrive only while a chat screen is open. For background push (and
foreground catch-up across screens), run the relay in [`../relay`](../relay) and set
`expo.extra.relayBase` to its URL. The relay becomes the sole `getUpdates` consumer and
fans out Expo push; the app pulls buffered messages from it. **Real background push needs
a real device + EAS dev/standalone build** (`eas build -p ios --profile development`) —
Expo Go and the simulator cannot receive remote push (the foreground relay-pull path does
work on the simulator). For a local relay over `http://localhost`, the iOS
`NSAllowsLocalNetworking` ATS exception is already set in `app.json`.

## Verified

- `npm run typecheck` — clean
- Domain unit smoke (`node --experimental-strip-types scripts/smoke-domain.ts`) — 13/13
  (GFM parse, safe-streaming token suppression, sensitive-arg masking, status rules)
- Live Telegram smoke (`node scripts/smoke-telegram.mjs <token> <chatId>`) — getMe /
  sendMessage / editMessageText / getUpdates / sendChatAction against api.telegram.org
- Maestro E2E (`e2e/`) — 4/4 against the standalone Release build (no Metro);
  `03-add-live-buddy` (live tag) green with `-e BOT_TOKEN=…`
- Relay-pull receive verified on the simulator (app renders a relay-buffered message)

## Architecture (TECH_SPEC §2)

```
app/                    Expo Router screens
src/domain/             pure entities + markdown parser (no RN imports)
src/application/        Zustand stores + use-cases
src/infrastructure/     Bot API / relay / trace stream clients, push, ReceiveSource,
                        SecureStore, kv (sqlite native / localStorage web)
src/ui, src/components   markdown renderer, trace panel, bubbles
```

Receive is abstracted behind a `ReceiveSource` port: `TelegramPollSource` (no relay,
foreground direct poll) or `RelayPullSource` (relay set). Both funnel through
`useChatStore.ingestUpdates` — the single dedupe/offset authority shared by poll, pull,
and push handlers. Sending stays direct to the gateway in both modes.
