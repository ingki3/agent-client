export type BuddyId = string;

export interface Buddy {
  id: BuddyId;
  username: string;
  displayName: string;
  iconUrl: string | null;
  traceSupported: boolean;
  lastMessagePreview: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  createdAt: number;
}
