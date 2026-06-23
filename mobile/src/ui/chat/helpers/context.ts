/**
 * Pure helpers for helper-action forms: field defaults/validation, value
 * summarisation, and the compact message-context payload sent to the relay.
 */
import type { FormValue, HelperField, Message } from '@/domain/entities/Message';

import { tgMessageId } from '../chatMessageUtils';

import type { HelperActionPayload } from './types';

export function initialFieldValue(field: HelperField): FormValue {
  if (field.kind === 'multi_select') return [];
  if (field.kind === 'confirm') return false;
  if (field.kind === 'number') return null;
  return '';
}

export function present(value: FormValue | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function summarizeValues(values: Record<string, FormValue>): string {
  return Object.entries(values)
    .filter(([, value]) => present(value))
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join(', ')}`;
      return `${key}: ${String(value)}`;
    })
    .join('\n') || '폼 제출';
}

export function displayActionValue(payload: HelperActionPayload): string {
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

export function helperSource(message: Message, timeline: Message[]) {
  const source = compactMessageContext(message, 2000);
  const index = timeline.findIndex((item) => item.clientMessageId === message.clientMessageId);
  const end = index >= 0 ? index + 1 : timeline.length;
  const recent = timeline.slice(Math.max(0, end - 5), end).map((item) => compactMessageContext(item, 1000));
  return {
    ...source,
    recentMessages: recent,
  };
}
