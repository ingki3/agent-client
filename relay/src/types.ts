/** Telegram update shapes — mirror the app's telegramBotApi.ts so /pull is drop-in. */
export type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  /** Relative relay path that proxies the Telegram webpage photo; app prepends relayBase. */
  image?: string;
};

export type TgMessage = {
  message_id: number;
  date: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; is_bot: boolean; first_name: string; username?: string };
  /** True when the user sent this message (from any client) — app renders it as "user". */
  outgoing?: boolean;
  /** Telegram webpage preview (Open-Graph-like) for a link in the message. */
  preview?: LinkPreview;
  /** Attached media (photo/document/video/voice); `url` is a relay path to fetch the bytes. */
  media?: { kind: string; name: string; mime: string; size?: number; url: string };
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
};

// botToken is optional: MTProto peers (user-account path) register a subscription with no
// token (the relay's GramJS client receives for them — no per-bot getUpdates loop).
export type RegisterBot = { buddyId: string; botToken?: string; botId: number };

export type RegisterBody = {
  deviceId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  gateway: string;
  bots: RegisterBot[];
};

// ─── MTProto (user-account) request bodies ───────────────────────────────────
export type AuthStartBody = { deviceId: string; phone: string };
export type AuthCodeBody = { deviceId: string; code: string };
export type Auth2faBody = { deviceId: string; password: string };
export type PeerResolveBody = { deviceId: string; username: string };
export type SendBody = { deviceId: string; peerId: number; text: string; clientTag?: string; replyTo?: number };
