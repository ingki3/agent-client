# Agent Client — Push Relay

A minimal, self-owned service that makes **background push notifications** possible for
the Agent Client app when the external gateway (Hermes/agent) cannot be modified.

## Why this exists

The gateway is a Telegram-compatible proxy you point a **bot token** at
(`{gateway}/bot{token}/{method}`). It won't push for us. Background push needs an
always-on process to (a) be the **sole `getUpdates` consumer** per bot and (b) call
APNs/FCM. This relay is that process; it uses **Expo Push** so there are no certs to manage.

> Telegram `getUpdates` is single-consumer. While the relay runs, the **app must not**
> poll `getUpdates` directly — it pulls buffered updates from `/pull` instead. Sending
> (`sendMessage`) stays direct to the gateway (it doesn't consume the update queue).

## Run

```bash
cd relay
npm install
RELAY_MASTER_KEY=$(openssl rand -hex 32) npm start   # prod: set a real key
# dev (boots with a fixed dev key, warns loudly):
npm run dev
```

Env: `PORT` (8787), `HOST`, `RELAY_DB` (relay.db), `RELAY_MASTER_KEY` (AES-256-GCM key
for bot tokens at rest — **required in production**).

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/register` | `{deviceId, expoPushToken, platform, gateway, bots:[{buddyId,botToken,botId}]}` → `{ok, deviceSecret?, registered}` |
| POST | `/unregister` | `{deviceId, botId?}` (Bearer deviceSecret) — drop a bot or the device |
| GET | `/pull` | `?deviceId=&botId=&since=<update_id>` (Bearer) → `{ok, updates:[TgUpdate], cursor}` |
| GET | `/health` | loop/offset snapshot |

`deviceSecret` is returned once on first register; send it as `Authorization: Bearer …`
on subsequent calls. Bot tokens are AES-256-GCM encrypted at rest and never logged.

## Smoke test (no device needed)

```bash
cd relay && npm install
node --import tsx src/smoke.ts <botToken> [gateway]
# → registers the bot, then message the bot from Telegram; verifies /pull returns it.
```

## Deploy

Must stay **always-on** (a sleeping instance stops being the single consumer). Use a
persistent process with a volume for the SQLite DB:

- **Fly.io** (small always-on VM + volume) — recommended
- **Railway** / **Render** (paid worker; the free web tier sleeps — avoid)
- Not serverless: long-poll loops need a persistent process.

## Limitations

- If the relay is down longer than Telegram's update retention (~24h), messages in that
  window are lost. Run with uptime monitoring + auto-restart.
- Bot tokens live here (encrypted) so the relay can poll on the user's behalf — the
  tradeoff for background push under the un-modifiable-gateway constraint.
