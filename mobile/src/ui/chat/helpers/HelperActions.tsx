/**
 * Helper-action UI for an agent message: renders the list of usable helper
 * items below the bubble and owns the per-item submit lifecycle (optimistic
 * local echo + relay submit + de-dupe).
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useChatStore } from '@/application/stores/chat-store';
import type { Message , HelperItem } from '@/domain/entities/Message';
import { space } from '@/ui/theme/tokens';

import { appendLocalDisplayMessageFlow, sendMessageFlow } from '../../../../app/_runtime/chat';

import { ArtifactHelper } from './ArtifactHelper';
import { ConfirmHelper } from './ConfirmHelper';
import { displayActionValue } from './context';
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
    if (!Number.isFinite(Number(message.buddyId))) {
      appendLocal('후속 액션을 보낼 대상 agent 연결을 찾지 못했습니다.', 'system');
      return;
    }
    const text = displayActionValue(payload).trim();
    if (!text) return;
    setDone((prev) => ({ ...prev, [key]: true }));
    // Send the selection as a plain conversational message — the agent already
    // holds the conversation context, so no JSON/source wrapper is needed. Reuses
    // the normal send path (optimistic bubble + echo reconcile, no duplicate).
    const outcome = await sendMessageFlow(message.buddyId, text);
    if (outcome.kind === 'failed') {
      setDone((prev) => ({ ...prev, [key]: false }));
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
