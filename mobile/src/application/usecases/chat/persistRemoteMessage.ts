import type { Message } from '@/domain/entities/Message';
import { isHiddenHelperSubmitMessage } from '@/domain/messages/hiddenMessages';

import type { ChatUseCaseDeps, RelayMessageSnapshot } from './types';

export function snapshotRichFields(
  snapshot: RelayMessageSnapshot,
): Partial<Pick<Message, 'preview' | 'helperItems' | 'inlineKeyboard' | 'attachments' | 'text'>> {
  const fields: Partial<Pick<Message, 'preview' | 'helperItems' | 'inlineKeyboard' | 'attachments' | 'text'>> = {
    text: snapshot.text,
  };
  if (snapshot.preview) fields.preview = snapshot.preview;
  if (snapshot.helperItems) fields.helperItems = snapshot.helperItems;
  if (snapshot.inlineKeyboard !== undefined) fields.inlineKeyboard = snapshot.inlineKeyboard;
  if (snapshot.media) {
    const attachment = {
      kind: snapshot.media.kind,
      uri: snapshot.media.url,
      name: snapshot.media.name,
      mime: snapshot.media.mime,
    };
    fields.attachments = snapshot.media.size == null ? [attachment] : [{ ...attachment, size: snapshot.media.size }];
  }
  return fields;
}

export function snapshotToPersistedMessage(snapshot: RelayMessageSnapshot): Message {
  const message: Message = {
    id: String(snapshot.messageId),
    clientMessageId: String(snapshot.messageId),
    buddyId: String(snapshot.peerId),
    role: snapshot.role,
    text: snapshot.text,
    status: 'sent',
    createdAt: snapshot.date * 1000,
    traceId: null,
  };
  const fields = snapshotRichFields(snapshot);
  if (fields.preview) message.preview = fields.preview;
  if (fields.helperItems) message.helperItems = fields.helperItems;
  if (fields.inlineKeyboard !== undefined) message.inlineKeyboard = fields.inlineKeyboard;
  if (fields.attachments) message.attachments = fields.attachments;
  return message;
}

export function persistRemoteMessage(
  deps: Pick<ChatUseCaseDeps, 'db' | 'messagesRepo' | 'messageSyncStateRepo'>,
  snapshot: RelayMessageSnapshot,
): Message | null {
  const buddyId = String(snapshot.peerId);
  if (isHiddenHelperSubmitMessage(snapshot)) {
    deps.messageSyncStateRepo.advanceCursor(buddyId, snapshot.cursor, snapshot.updatedAt || Date.now());
    return null;
  }

  const serverId = String(snapshot.messageId);
  let result: Message | null = null;

  deps.db.transaction(() => {
    const existing = deps.messagesRepo.findByServerId(serverId) ?? deps.messagesRepo.findByClientMessageId(serverId);
    if (existing) {
      result = deps.messagesRepo.mergeRemoteFields(serverId, snapshotRichFields(snapshot)) ?? deps.messagesRepo.findByServerId(serverId);
    } else {
      result = deps.messagesRepo.insertRemoteIfAbsent(snapshotToPersistedMessage(snapshot));
    }
    deps.messageSyncStateRepo.advanceCursor(buddyId, snapshot.cursor, snapshot.updatedAt || Date.now());
  });

  return result;
}
