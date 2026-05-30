export const KvKeys = {
  buddies: "buddies_v1",
  messages: (buddyId: string) => `messages_v1_${buddyId}`,
  /** Receive cursor (Telegram update_id / relay pull cursor) per buddy. */
  offset: (buddyId: string) => `offset_v1_${buddyId}`,
} as const;
