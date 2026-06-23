/**
 * Helper-action UI for an agent message: renders the list of usable helper
 * items below the bubble and owns the per-item submit lifecycle (optimistic
 * local echo + relay submit + de-dupe).
 */
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useChatStore } from '@/application/stores/chat-store';
import type { Message , HelperItem } from '@/domain/entities/Message';
import { relayClient } from '@/infrastructure/api/relayClient';
import { space } from '@/ui/theme/tokens';

import { appendLocalDisplayMessageFlow } from '../../../../app/_runtime/chat';

import { ArtifactHelper } from './ArtifactHelper';
import { ConfirmHelper } from './ConfirmHelper';
import { displayActionValue, helperSource } from './context';
import { InputFormHelper } from './InputFormHelper';
import { HelperChip } from './primitives';
import { SelectHelper } from './SelectHelper';
import {
  isUsableHelperItem,
  type ChoiceItem,
  type ConfirmItem,
  type ArtifactItem,
  type HelperActionPayload,
  type InputFormItem,
  type QuickRepliesItem,
} from './types';


export function HelperActions({ message }: { message: Message }) {
  const items = (message.helperItems ?? []).filter(isUsableHelperItem);
  if (!items.length || message.inlineKeyboard?.rows.length) return null;

  return (
    <View style={{ marginTop: space[2], gap: space[2] }}>
      {items.map((item) => (
        <HelperItemCard key={item.id} item={item} message={message} />
      ))}
    </View>
  );
}

function HelperItemCard({ item, message }: { item: HelperItem; message: Message }) {
  const appendMessage = useChatStore((s) => s.appendMessage);
  const ids = useChatStore((s) => s.byBuddy[message.buddyId] ?? []);
  const messagesById = useChatStore((s) => s.messages);
  const timeline = useMemo(
    () => ids.map((id) => messagesById[id]).filter((m): m is Message => !!m),
    [ids, messagesById],
  );
  const [done, setDone] = useState<Record<string, boolean>>({});

  const appendLocal = (text: string, role: Message['role']) => {
    try {
      appendLocalDisplayMessageFlow(message.buddyId, text, role);
    } catch {
      appendMessage({
        id: null,
        clientMessageId: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        buddyId: message.buddyId,
        role,
        text,
        status: 'sent',
        createdAt: Date.now(),
        traceId: null,
      });
    }
  };

  const send = async (key: string, payload: HelperActionPayload) => {
    if (done[key]) return;
    const peerId = Number(message.buddyId);
    if (!Number.isFinite(peerId)) {
      appendLocal('후속 액션을 보낼 대상 agent 연결을 찾지 못했습니다.', 'system');
      return;
    }
    setDone((prev) => ({ ...prev, [key]: true }));
    appendLocal(displayActionValue(payload), 'user');
    const ok = await relayClient.submitHelperAction(peerId, {
      helperItemId: item.id,
      helperType: item.type,
      ...payload,
      source: helperSource(message, timeline),
    });
    if (!ok) {
      setDone((prev) => ({ ...prev, [key]: false }));
      appendLocal('후속 액션 전송에 실패했습니다. 네트워크 또는 relay 연결을 확인해 주세요.', 'system');
    }
  };

  if (item.type === 'quick_replies') {
    const quick = item as QuickRepliesItem;
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
        {quick.options.map((opt) => {
          const key = `${quick.id}:${opt.value}`;
          return (
            <HelperChip
              key={opt.value}
              label={opt.label}
              disabled={!!done[key]}
              onPress={() => void send(key, {
                action: 'quick_reply',
                label: opt.label,
                value: opt.value,
              })}
            />
          );
        })}
      </ScrollView>
    );
  }

  if (item.type === 'single_select' || item.type === 'multi_select') {
    return <SelectHelper item={item as ChoiceItem} done={done} onSend={send} />;
  }

  if (item.type === 'input_form') {
    return <InputFormHelper item={item as InputFormItem} done={done} onSend={send} />;
  }

  if (item.type === 'confirm_action') {
    return <ConfirmHelper item={item as ConfirmItem} done={done} onSend={send} />;
  }

  if (item.type === 'artifact_suggestion') {
    return <ArtifactHelper item={item as ArtifactItem} done={done} onSend={send} />;
  }

  return null;
}
