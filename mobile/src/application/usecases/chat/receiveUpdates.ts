/**
 * receiveUpdates — getUpdates polling 결과를 SQLite + chat store 로 반영 (FR-12).
 *
 * Telegram-호환 `getUpdates(offset=last_update_id+1)` 를 5~10s 주기로 호출하고
 * 신규 update.message 만 골라 봇 메시지로 영속화한다. 같은 message_id 가 다시
 * 들어오면 중복 INSERT 를 피한다 (`messages.id` UNIQUE).
 *
 * 반환값:
 *   - newOffset — 다음 호출 `offset` 값 (가장 큰 update_id + 1)
 *   - inserted  — 새로 INSERT 된 메시지 (caller 가 `useChatStore.appendMessage`)
 */
import type { BuddyId } from '@/domain/entities/Buddy';
import type { Message } from '@/domain/entities/Message';

import { BuddyNotFoundError, type ChatUseCaseDeps, MissingBotTokenError } from './types';

export interface ReceiveUpdatesInput {
  buddyId: BuddyId;
  /** 다음에 가져올 update_id 의 하한선. 첫 호출은 0 또는 saved last + 1. */
  offset: number;
  /** 폴링 long-poll timeout (초). 0 이면 즉시 반환 (mock 친화). */
  timeoutSec?: number;
}

export interface ReceiveUpdatesOutcome {
  newOffset: number;
  inserted: Message[];
  /** typing indicator on/off — 봇 측의 sendChatAction("typing") 가 있을 때만 표면화. */
  typing: boolean;
}

export async function receiveUpdates(
  deps: ChatUseCaseDeps,
  input: ReceiveUpdatesInput,
): Promise<ReceiveUpdatesOutcome> {
  const buddy = deps.buddiesRepo.findById(input.buddyId);
  if (!buddy) throw new BuddyNotFoundError(input.buddyId);
  let token: string | null = null;
  try {
    token = await deps.tokenStore.load(buddy.id);
  } catch {
    token = null;
  }

  const peerId = Number(buddy.id);
  const useRelaySync = !token && deps.relaySyncMessages && Number.isFinite(peerId);
  if (!token && !useRelaySync) throw new MissingBotTokenError(buddy.id);

  const updates = useRelaySync
    ? await deps.relaySyncMessages!(peerId, input.offset, 50)
    : await deps.botApi.getUpdates(token!, {
        offset: input.offset,
        timeout: input.timeoutSec ?? 0,
        allowed_updates: ['message', 'edited_message'],
      });

  const inserted: Message[] = [];
  const seenServerIds = new Set<string>();
  let newOffset = input.offset;
  let typing = false;

  deps.db.transaction(() => {
    for (const u of updates) {
      if (u.update_id >= newOffset) newOffset = u.update_id + 1;
      const tg = u.message ?? u.edited_message;
      if (!tg) continue;
      // Bot API 친구는 기존처럼 봇 메시지만 수신한다. Relay sync는 Telegram history라
      // 다른 클라이언트에서 보낸 내 메시지도 복원해야 하므로 outgoing을 허용한다.
      if (!useRelaySync && tg.from?.is_bot !== true) continue;
      // 우리 buddy 의 chat_id 와 매칭되는 것만 받는다.
      if (String(tg.chat.id) !== buddy.id) continue;

      const serverId = String(tg.message_id);
      if (seenServerIds.has(serverId)) continue;
      seenServerIds.add(serverId);
      const richFields: Partial<Pick<Message, 'preview' | 'helperItems' | 'inlineKeyboard' | 'attachments' | 'text'>> = {};
      if (tg.preview) richFields.preview = tg.preview;
      if (tg.helper_items) richFields.helperItems = tg.helper_items;
      if (tg.inline_keyboard !== undefined) richFields.inlineKeyboard = tg.inline_keyboard;
      if (tg.media) {
        const attachment = { kind: tg.media.kind, uri: tg.media.url, name: tg.media.name, mime: tg.media.mime };
        richFields.attachments = tg.media.size == null ? [attachment] : [{ ...attachment, size: tg.media.size }];
      }
      if (tg.text !== undefined) richFields.text = tg.text;
      const existing = deps.messagesRepo.findByServerId(serverId) ?? deps.messagesRepo.findByClientMessageId(serverId);
      if (existing) {
        const merged = deps.messagesRepo.mergeRemoteFields(serverId, richFields);
        if (merged) inserted.push(merged);
        continue;
      }

      const message: Message = {
        id: serverId,
        clientMessageId: serverId, // 봇 메시지는 client-side ID 가 없어 server id 를 재사용
        buddyId: buddy.id,
        role: tg.outgoing ? 'user' : 'agent',
        text: tg.text ?? '',
        status: 'sent',
        createdAt: (tg.date ?? 0) * 1000,
        traceId: null,
      };
      if (richFields.preview) message.preview = richFields.preview;
      if (richFields.helperItems) message.helperItems = richFields.helperItems;
      if (richFields.inlineKeyboard !== undefined) message.inlineKeyboard = richFields.inlineKeyboard;
      if (richFields.attachments) message.attachments = richFields.attachments;
      const insertedMessage = deps.messagesRepo.insertRemoteIfAbsent(message);
      if (insertedMessage) inserted.push(insertedMessage);
    }
  });

  return { newOffset, inserted, typing };
}
