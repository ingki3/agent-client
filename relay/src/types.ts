/** Telegram update shapes — mirror the app's telegramBotApi.ts so /pull is drop-in. */
export type TgMessage = {
  message_id: number;
  date: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; is_bot: boolean; first_name: string; username?: string };
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
};

export type RegisterBot = { buddyId: string; botToken: string; botId: number };

export type RegisterBody = {
  deviceId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  gateway: string;
  bots: RegisterBot[];
};
