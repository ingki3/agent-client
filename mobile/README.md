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
anytime from the simulator/device home screen. Verified on the iOS simulator:

```bash
cd mobile
npx expo run:ios --configuration Release   # builds, installs, launches (no Metro needed)
```

Login is DEV mode (no gateway): any phone number + code `000000`.

## Verified

- `npm run typecheck` — clean
- Domain unit smoke (`node --experimental-strip-types scripts/smoke-domain.ts`) — 13/13
  (GFM parse, safe-streaming token suppression, sensitive-arg masking, status rules)
- Live Telegram smoke (`node scripts/smoke-telegram.mjs <token> <chatId>`) — getMe /
  sendMessage / editMessageText / getUpdates / sendChatAction against api.telegram.org
- Maestro E2E (`e2e/`) — 01/02/04/05 green against the standalone Release build (no
  Metro); `03-add-live-buddy` green with `-e BOT_TOKEN=…`

## What works

- **Auth (S-01/02/03)** — phone + SMS code flow, token in SecureStore, auto-login.
  No backend? Runs in **DEV mode**: any valid-looking number proceeds; code `000000`
  (or any 6 digits) verifies.
- **Add buddy (S-12/13)** — bot token → real `getMe` validation + preview → SecureStore.
  Dedupes by bot id (D-03).
- **Friends list (S-10)** — list, FAB add, long-press → delete (M-02 → D-04).
- **Chat (S-11)** — send/receive, message status, **streaming render**, **GFM markdown**
  (headings, bold/italic/strike, code, lists, checkboxes, tables, blockquote, links, hr),
  Stop control, failed-message retry (D-02).
- **Trace (I-01/M-01)** — thinking / tool_call / tool_result panel, live during stream,
  raw JSON with sensitive-arg masking. Hidden for standard bots (fallback).
- **Settings (S-20/21)** + logout (D-05) wipes all tokens + cache.

## Telegram protocol

Every Bot API call goes to `{gateway}/bot{token}/{method}` (Telegram standard):
`getMe`, `sendMessage`, `editMessageText`, `getUpdates` (long-poll), `sendChatAction`.

- **Default gateway** = `https://api.telegram.org` → the app talks to **real Telegram
  bots**. A bot token acts *as the bot*: `getUpdates` returns messages sent **to** the
  bot (rendered as the counterpart side; `chatId` is learned from the first one).
- **Agent Gateway** — set `expo.extra.gateway` / `expo.extra.apiBase` in `app.json` to
  point at a gateway that adds the phone-auth API and the SSE **trace + delta** stream.
  No UI changes needed; trace events upgrade buddies to the trace-supporting path.

Mock seed buddies (no token) demonstrate streaming + markdown + trace without a backend.

## Architecture (TECH_SPEC §2)

```
app/                    Expo Router screens
src/domain/             pure entities + markdown parser (no RN imports)
src/application/        Zustand stores + use-cases
src/infrastructure/     Bot API / Auth / trace stream clients, SecureStore, kv (sqlite)
src/ui, src/components   markdown renderer, trace panel, bubbles
```
