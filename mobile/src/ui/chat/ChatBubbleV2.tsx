/**
 * S-11 말풍선 (BIZ-266 production 버전).
 *
 * - 사용자/봇/시스템 3 종 layout
 * - 본문은 `Markdown` 컴포넌트로 렌더 (GFM full-spec, FR-15)
 * - 상태 아이콘 5종 + 타임스탬프
 * - 길게 누름 (D-02): 실패한 user 메시지에서만 onLongPress 가 활성화
 */
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type {
  FormValue,
  HelperField,
  HelperItem,
  HelperOption,
  Message,
} from '@/domain/entities/Message';
import { useChatStore } from '@/application/stores/chat-store';
import { relayClient } from '@/infrastructure/api/relayClient';
import { MessageTtsControls } from '@/ui/components/MessageTtsControls';

import { Markdown } from '../markdown';
import { useTheme } from '../theme/ThemeProvider';
import { fontSize, radius, space } from '../theme/tokens';

import { StatusIcon } from './StatusIcon';
import { MessageAttachments } from './MessageAttachments';
import { LinkPreviewCard } from './LinkPreviewCard';
import { InlineKeyboardPanel } from './InlineKeyboardPanel';
import { formatMessageTime, tgMessageId } from './chatMessageUtils';
import { appendLocalDisplayMessageFlow } from '../../../app/_runtime/chat';

interface Props {
  message: Message;
  /** D-02 핸들러 — 실패 / 큐잉 메시지에서만 호출됨. */
  onLongPress?: (message: Message) => void;
}

export const ChatBubbleV2 = memo(function ChatBubbleV2({ message, onLongPress }: Props) {
  const { color } = useTheme();
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const longPressable = isUser && (message.status === 'failed' || message.status === 'queued');

  if (isSystem) {
    return (
      <View style={{ paddingVertical: space[3], alignItems: 'center' }}>
        <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
          {message.text}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        paddingHorizontal: space[4],
        paddingVertical: space[1],
      }}
    >
      <View style={{ maxWidth: isUser ? '84%' : '94%' }}>
        <Pressable
          onLongPress={longPressable ? () => onLongPress?.(message) : undefined}
          delayLongPress={350}
          accessibilityRole={longPressable ? 'button' : undefined}
        >
          <View
            style={{
              backgroundColor: color(isUser ? 'user-bubble' : 'agent-bubble'),
              borderRadius: radius.bubble,
              paddingHorizontal: space[3],
              paddingVertical: space[2],
              opacity: message.status === 'sending' || message.status === 'queued' ? 0.85 : 1,
              borderWidth: message.status === 'failed' ? 1 : 0,
              borderColor: color('error'),
            }}
          >
            <Markdown text={message.text} context={isUser ? 'user' : 'agent'} />
            <MessageAttachments message={message} />
            <LinkPreviewCard message={message} />
          </View>
        </Pressable>
        {!isUser ? <MessageTtsControls message={message} /> : null}
        {!isUser ? <InlineKeyboardPanel message={message} /> : null}
        {!isUser ? <HelperActions message={message} /> : null}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: isUser ? 'flex-end' : 'flex-start',
            alignItems: 'center',
            gap: space[1],
            marginTop: 2,
            paddingHorizontal: space[1],
          }}
        >
          <Text
            style={{
              color: color('text-secondary'),
              fontSize: fontSize.caption,
            }}
          >
            {formatMessageTime(message.createdAt)}
          </Text>
          {isUser ? <StatusIcon status={message.status} /> : null}
        </View>
      </View>
    </View>
  );
});

type QuickRepliesItem = HelperItem & {
  type: 'quick_replies';
  options: HelperOption[];
};

type ChoiceItem = HelperItem & {
  type: 'single_select' | 'multi_select';
  title: string;
  description?: string;
  options: HelperOption[];
  submitLabel?: string;
};

type InputFormItem = HelperItem & {
  type: 'input_form';
  title: string;
  description?: string;
  fields: HelperField[];
  submitLabel?: string;
  cancelLabel?: string;
};

type ConfirmItem = HelperItem & {
  type: 'confirm_action';
  title: string;
  description?: string;
  summary?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  reviseLabel?: string;
};

type ArtifactItem = HelperItem & {
  type: 'artifact_suggestion';
  title: string;
  artifact?: { kind?: string; title?: string; content?: string; language?: string };
};

type HelperActionPayload = {
  action: 'submit' | 'cancel' | 'revise' | 'quick_reply' | 'save_artifact';
  label?: string;
  value?: string;
  values?: Record<string, FormValue>;
};

function isUsableHelperItem(item: HelperItem): boolean {
  if (item.type === 'quick_replies') return Array.isArray((item as { options?: unknown }).options);
  if (item.type === 'single_select' || item.type === 'multi_select') {
    return Array.isArray((item as { options?: unknown }).options);
  }
  if (item.type === 'input_form') return Array.isArray((item as { fields?: unknown }).fields);
  if (item.type === 'confirm_action') return true;
  if (item.type === 'artifact_suggestion') return typeof (item as ArtifactItem).artifact === 'object';
  return false;
}

function HelperActions({ message }: { message: Message }) {
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

function HelperChip({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: color(disabled ? 'border' : 'trace-summary'),
        borderRadius: radius.full,
        paddingHorizontal: space[3],
        paddingVertical: space[2],
        minHeight: 36,
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: color(disabled ? 'text-disabled' : 'on-trace-summary'),
          fontSize: fontSize.caption,
          fontWeight: '700',
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SelectHelper({
  item,
  done,
  onSend,
}: {
  item: ChoiceItem;
  done: Record<string, boolean>;
  onSend: (key: string, payload: HelperActionPayload) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const disabled = !!done[item.id] || selected.length === 0;
  const single = item.type === 'single_select';

  const toggle = (value: string) => {
    setSelected((prev) => {
      if (single) return prev.includes(value) ? [] : [value];
      return prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
    });
  };

  return (
    <HelperShell title={item.title} description={item.description}>
      <View style={{ gap: space[2] }}>
        {item.options.map((opt) => {
          const checked = selected.includes(opt.value);
          return (
            <OptionRow
              key={opt.value}
              label={opt.label}
              checked={checked}
              multi={!single}
              onPress={() => toggle(opt.value)}
            />
          );
        })}
      </View>
      <SubmitButton
        disabled={disabled}
        label={item.submitLabel ?? '전송'}
        onPress={() => void onSend(item.id, {
          action: 'submit',
          label: selected
            .map((value) => item.options.find((opt) => opt.value === value)?.label ?? value)
            .join(', '),
          value: selected.join(', '),
          values: { selection: single ? selected[0] ?? null : selected },
        })}
      />
    </HelperShell>
  );
}

function InputFormHelper({
  item,
  done,
  onSend,
}: {
  item: InputFormItem;
  done: Record<string, boolean>;
  onSend: (key: string, payload: HelperActionPayload) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, FormValue>>(() => {
    const initial: Record<string, FormValue> = {};
    for (const field of item.fields) initial[field.id] = initialFieldValue(field);
    return initial;
  });
  const complete = item.fields.every((field) => !field.required || present(values[field.id]));
  const disabled = !!done[item.id] || !complete;
  const cancelLabel = item.cancelLabel;

  const update = (id: string, value: FormValue) => {
    setValues((prev) => ({ ...prev, [id]: value }));
  };

  return (
    <HelperShell title={item.title} description={item.description}>
      <View style={{ gap: space[3] }}>
        {item.fields.map((field) => (
          <HelperFieldInput
            key={field.id}
            field={field}
            value={values[field.id]}
            onChange={(value) => update(field.id, value)}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        {cancelLabel ? (
          <GhostButton
            label={cancelLabel}
            disabled={!!done[`${item.id}:cancel`]}
            onPress={() => void onSend(`${item.id}:cancel`, {
              action: 'cancel',
              label: cancelLabel,
              value: cancelLabel,
              values,
            })}
          />
        ) : null}
        <SubmitButton
          disabled={disabled}
          label={item.submitLabel ?? '전송'}
          onPress={() => void onSend(item.id, {
            action: 'submit',
            label: item.submitLabel ?? '전송',
            value: summarizeValues(values),
            values,
          })}
        />
      </View>
    </HelperShell>
  );
}

function ConfirmHelper({
  item,
  done,
  onSend,
}: {
  item: ConfirmItem;
  done: Record<string, boolean>;
  onSend: (key: string, payload: HelperActionPayload) => Promise<void>;
}) {
  const { color } = useTheme();
  const reviseLabel = item.reviseLabel;
  const cancelLabel = item.cancelLabel;
  return (
    <HelperShell title={item.title} description={item.description}>
      {item.summary?.length ? (
        <View style={{ gap: space[1] }}>
          {item.summary.map((line, index) => (
            <Text key={`${line}-${index}`} style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        {reviseLabel ? (
          <GhostButton
            label={reviseLabel}
            disabled={!!done[`${item.id}:revise`]}
            onPress={() => void onSend(`${item.id}:revise`, {
              action: 'revise',
              label: reviseLabel,
              value: reviseLabel,
            })}
          />
        ) : null}
        {cancelLabel ? (
          <GhostButton
            label={cancelLabel}
            disabled={!!done[`${item.id}:cancel`]}
            onPress={() => void onSend(`${item.id}:cancel`, {
              action: 'cancel',
              label: cancelLabel,
              value: cancelLabel,
            })}
          />
        ) : null}
        <SubmitButton
          disabled={!!done[item.id]}
          label={item.confirmLabel ?? '확인'}
          onPress={() => void onSend(item.id, {
            action: 'submit',
            label: item.confirmLabel ?? '확인',
            value: item.confirmLabel ?? '확인',
          })}
        />
      </View>
    </HelperShell>
  );
}

function ArtifactHelper({
  item,
  done,
  onSend,
}: {
  item: ArtifactItem;
  done: Record<string, boolean>;
  onSend: (key: string, payload: HelperActionPayload) => Promise<void>;
}) {
  const { color } = useTheme();
  const artifactTitle = item.artifact?.title ?? item.title;
  const artifactKind = item.artifact?.kind ?? 'artifact';
  return (
    <HelperShell title={item.title}>
      <View
        style={{
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color('border'),
          padding: space[3],
          gap: space[1],
        }}
      >
        <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>{artifactKind}</Text>
        <Text style={{ color: color('text-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }}>
          {artifactTitle}
        </Text>
      </View>
      <SubmitButton
        disabled={!!done[item.id]}
        label="산출물로 저장"
        onPress={() => void onSend(item.id, {
          action: 'save_artifact',
          label: '산출물로 저장',
          value: artifactTitle,
        })}
      />
    </HelperShell>
  );
}

function HelperShell({
  title,
  description,
  children,
}: {
  title?: string | undefined;
  description?: string | undefined;
  children: ReactNode;
}) {
  const { color } = useTheme();
  return (
    <View
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color('border'),
        backgroundColor: color('surface-elevated'),
        padding: space[3],
        gap: space[3],
      }}
    >
      {title || description ? (
        <View style={{ gap: space[1] }}>
          {title ? (
            <Text style={{ color: color('text-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }}>
              {title}
            </Text>
          ) : null}
          {description ? (
            <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
              {description}
            </Text>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

function SubmitButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 40,
        borderRadius: radius.md,
        backgroundColor: color(disabled ? 'border' : 'primary'),
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space[3],
      }}
    >
      <Text
        style={{ color: color(disabled ? 'text-disabled' : 'on-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function GhostButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 40,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color('border'),
        backgroundColor: color('surface-elevated'),
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space[3],
      }}
    >
      <Text
        style={{ color: color(disabled ? 'text-disabled' : 'text-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function OptionRow({
  label,
  checked,
  multi,
  onPress,
}: {
  label: string;
  checked: boolean;
  multi: boolean;
  onPress: () => void;
}) {
  const { color } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: multi ? radius.sm : radius.full,
          borderWidth: 1,
          borderColor: checked ? color('primary') : color('border-strong'),
          backgroundColor: checked ? color('primary') : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <Text style={{ color: color('on-primary'), fontSize: 12, fontWeight: '800' }}>✓</Text>
        ) : null}
      </View>
      <Text style={{ flex: 1, color: color('text-primary'), fontSize: fontSize['body-sm'] }}>
        {label}
      </Text>
    </Pressable>
  );
}

function HelperFieldInput({
  field,
  value,
  onChange,
}: {
  field: HelperField;
  value: FormValue | undefined;
  onChange: (value: FormValue) => void;
}) {
  const { color } = useTheme();

  if (field.kind === 'confirm') {
    return (
      <OptionRow
        label={field.label}
        checked={value === true}
        multi
        onPress={() => onChange(value === true ? false : true)}
      />
    );
  }

  if (field.kind === 'single_select' || field.kind === 'multi_select') {
    const selected = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
    const single = field.kind === 'single_select';
    return (
      <View style={{ gap: space[2] }}>
        <FieldLabel field={field} />
        {(field.options ?? []).map((opt) => (
          <OptionRow
            key={opt.value}
            label={opt.label}
            checked={selected.includes(opt.value)}
            multi={!single}
            onPress={() => {
              if (single) {
                onChange(selected.includes(opt.value) ? null : opt.value);
              } else {
                onChange(selected.includes(opt.value)
                  ? selected.filter((v) => v !== opt.value)
                  : [...selected, opt.value]);
              }
            }}
          />
        ))}
      </View>
    );
  }

  const text = value == null ? '' : String(value);
  return (
    <View style={{ gap: space[1] }}>
      <FieldLabel field={field} />
      <TextInput
        value={text}
        onChangeText={(next) => onChange(field.kind === 'number' ? Number(next) || 0 : next)}
        placeholder={field.placeholder}
        placeholderTextColor={color('text-secondary')}
        keyboardType={field.kind === 'number' ? 'numeric' : 'default'}
        multiline={field.kind === 'textarea'}
        style={{
          minHeight: field.kind === 'textarea' ? 80 : 42,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color('border'),
          backgroundColor: color('surface'),
          color: color('text-primary'),
          fontSize: fontSize['body-sm'],
          paddingHorizontal: space[3],
          paddingVertical: space[2],
          textAlignVertical: field.kind === 'textarea' ? 'top' : 'center',
        }}
      />
    </View>
  );
}

function FieldLabel({ field }: { field: HelperField }) {
  const { color } = useTheme();
  return (
    <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption, fontWeight: '700' }}>
      {field.label}{field.required ? ' *' : ''}
    </Text>
  );
}

function initialFieldValue(field: HelperField): FormValue {
  if (field.kind === 'multi_select') return [];
  if (field.kind === 'confirm') return false;
  if (field.kind === 'number') return null;
  return '';
}

function present(value: FormValue | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function summarizeValues(values: Record<string, FormValue>): string {
  return Object.entries(values)
    .filter(([, value]) => present(value))
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join(', ')}`;
      return `${key}: ${String(value)}`;
    })
    .join('\n') || '폼 제출';
}

function displayActionValue(payload: HelperActionPayload): string {
  if (payload.value?.trim()) return payload.value.trim();
  if (payload.values) return summarizeValues(payload.values);
  if (payload.label?.trim()) return payload.label.trim();
  return '후속 액션 실행';
}

function compactMessageContext(message: Message, textLimit: number) {
  const text = message.text ?? '';
  const source: {
    messageId?: number;
    role?: string;
    text?: string;
    excerpt?: string;
    urls?: string[];
    preview?: { url?: string; title?: string; description?: string; siteName?: string };
    attachments?: Array<{ kind?: string; name?: string; mime?: string; size?: number }>;
  } = {};
  const messageId = tgMessageId(message.id);
  if (messageId !== undefined) source.messageId = messageId;
  source.role = message.role;
  if (text) {
    source.text = text.slice(0, textLimit);
    source.excerpt = text.replace(/\s+/g, ' ').trim().slice(0, Math.min(500, textLimit));
  }
  if (message.preview?.url) source.urls = [message.preview.url];
  if (message.preview) {
    const preview: { url?: string; title?: string; description?: string; siteName?: string } = {};
    if (message.preview.url) preview.url = message.preview.url;
    if (message.preview.title) preview.title = message.preview.title;
    if (message.preview.description) preview.description = message.preview.description;
    if (message.preview.siteName) preview.siteName = message.preview.siteName;
    source.preview = preview;
  }
  if (message.attachments?.length) {
    source.attachments = message.attachments.map((attachment) => {
      const item: { kind?: string; name?: string; mime?: string; size?: number } = {};
      if (attachment.kind) item.kind = attachment.kind;
      if (attachment.name) item.name = attachment.name;
      if (attachment.mime) item.mime = attachment.mime;
      if (attachment.size !== undefined) item.size = attachment.size;
      return item;
    });
  }
  return source;
}

function helperSource(message: Message, timeline: Message[]) {
  const source = compactMessageContext(message, 2000);
  const index = timeline.findIndex((item) => item.clientMessageId === message.clientMessageId);
  const end = index >= 0 ? index + 1 : timeline.length;
  const recent = timeline.slice(Math.max(0, end - 5), end).map((item) => compactMessageContext(item, 1000));
  return {
    ...source,
    recentMessages: recent,
  };
}
