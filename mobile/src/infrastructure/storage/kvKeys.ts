export const KvKeys = {
  buddies: "buddies_v1",
  messages: (buddyId: string) => `messages_v1_${buddyId}`,
  tasks: (buddyId: string) => `tasks_v1_${buddyId}`,
  artifacts: (buddyId: string) => `artifacts_v1_${buddyId}`,
  forms: (buddyId: string) => `forms_v1_${buddyId}`,
  /** Receive cursor (Telegram update_id / relay pull cursor) per buddy. */
  offset: (buddyId: string) => `offset_v1_${buddyId}`,
} as const;
