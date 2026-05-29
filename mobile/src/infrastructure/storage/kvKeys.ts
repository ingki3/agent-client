export const KvKeys = {
  buddies: "buddies_v1",
  messages: (buddyId: string) => `messages_v1_${buddyId}`,
} as const;
