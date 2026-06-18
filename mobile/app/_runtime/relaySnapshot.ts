import type { BuddyId } from '@/domain/entities/Buddy';
import type { Message } from '@/domain/entities/Message';
import type { RelayMessageSnapshot } from '@/infrastructure/api/relayClient';

export function snapshotToMessage(snapshot: RelayMessageSnapshot, buddyId: BuddyId): Message {
  const message: Message = {
    id: String(snapshot.messageId),
    clientMessageId: String(snapshot.messageId),
    buddyId,
    role: snapshot.role,
    text: snapshot.text,
    status: 'sent',
    createdAt: snapshot.date * 1000,
    traceId: null,
  };
  if (snapshot.preview) message.preview = snapshot.preview;
  if (snapshot.helperItems) message.helperItems = snapshot.helperItems;
  if (snapshot.inlineKeyboard !== undefined) message.inlineKeyboard = snapshot.inlineKeyboard;
  if (snapshot.media) {
    const attachment = { kind: snapshot.media.kind, uri: snapshot.media.url, name: snapshot.media.name, mime: snapshot.media.mime };
    message.attachments = snapshot.media.size == null ? [attachment] : [{ ...attachment, size: snapshot.media.size }];
  }
  return message;
}
