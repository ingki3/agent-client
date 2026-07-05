# Phone-control MCP server

The relay is an **MCP server** exposing phone-control tools. An MCP-capable
client (the Telegram bot's runtime, or Claude Desktop / MCP Inspector for
testing) calls a tool; the relay wakes the user's phone via a silent FCM data
message; the phone executes natively (even when backgrounded/killed) and returns
the result. The phone never has to be unlocked or in hand.

```
MCP client (bot)  ──► relay /mcp ──► FCM data-message ──► phone (native) ──► /command/result ──► back to the tool call
```

## Endpoint

- URL: `<relayBase>/mcp` (e.g. `http://telegram-relay.2prostream.com/mcp`)
- Transport: **Streamable HTTP** (MCP spec). POST for JSON-RPC, GET for the SSE
  stream leg, DELETE to tear down a session.
- Auth: `Authorization: Bearer <mcpToken>` on **every** request.

## Prerequisites (relay runtime)

Set in `relay/.env`:

```
FCM_SERVICE_ACCOUNT_JSON=/abs/path/to/fcm-sa.json   # Firebase service account (secret)
FCM_PROJECT_ID=agent-client-73b5b
RELAY_MASTER_KEY=<your master key>                  # guards token minting + debug routes
```

The Firebase service-account JSON is downloaded from Firebase Console → Project
settings → Service accounts → Generate new private key. Keep it out of git.

The phone (app) must have registered its FCM token (automatic on login) and been
granted the runtime permissions (Settings → "에이전트 폰 제어 권한").

## Mint a client token

Bind a token to one phone (`deviceId`) and the Telegram peer it acts on
(`peerId`):

```
cd relay
node --import tsx scripts/mint-mcp-token.ts <deviceId> <peerId> [label]
```

Prints the token once (only its hash is stored). Find the values:

- `deviceId` — `SELECT device_id FROM devices WHERE fcm_token IS NOT NULL;`
  (or the app log line `register device=...`).
- `peerId` — the Telegram peer id of the agent/user context, from
  `SELECT peer_id, username, title FROM peers WHERE device_id='<deviceId>';`.

## Wiring an MCP client

**Testing (MCP Inspector):**

```
npx @modelcontextprotocol/inspector
```

Connect to `<relayBase>/mcp`, transport "Streamable HTTP", add header
`Authorization: Bearer <mcpToken>`. `tools/list` shows the tools; call them.

**The Telegram bot runtime:** register the relay as a remote MCP server in the
bot's MCP client config — the URL `<relayBase>/mcp` and the bearer token. The
exact config lives wherever the bot runs (outside this repo). Once connected,
the bot can call the tools during a conversation; it should **confirm with the
user in chat before any write tool** (Phase 3+), since actions are irreversible
and go out under the user's identity.

## Tools (Phase 1–2, SENSE + location)

| Tool | Args | Returns |
|---|---|---|
| `get_location` | — | `{ lat, lon, accuracy, address? }` |
| `read_sms` | `{ limit?, address? }` | `{ messages: [{ address, body, date, type }] }` |
| `find_contact` | `{ name }` | `{ contacts: [{ name, number }] }` |
| `list_media` | `{ type?: image\|video, limit? }` | `{ items: [{ ref, name, mime, size, dateAdded }] }` |
| `fetch_media` | `{ ref }` (from list_media) | `{ mime, name, base64 }` (≤ 8 MB) |

Errors come back as an `isError` tool result with a text like
`error: phone_unreachable` / `error: location_permission_denied`.

## Operational notes

- Every dispatched tool call is audited in `mcp_tool_calls` (tool, args, status,
  result, timestamps). `GET /health` reports `pendingCommands`.
- A tool call bounded-waits `COMMAND_TIMEOUT_MS` (default 30s); if the phone
  doesn't answer it returns `phone_unreachable`.
- **force-stop limitation:** Android does NOT deliver FCM to an app that was
  *force-stopped* (Settings → Force stop) until the user reopens it once.
  Normal background / swipe-away / system-kill / Doze all wake fine.
