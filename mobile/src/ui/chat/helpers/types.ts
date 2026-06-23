/**
 * Narrowed helper-item shapes + the action payload, shared across the helper
 * sub-components extracted from ChatBubbleV2.
 */
import type { FormValue, HelperField, HelperItem, HelperOption } from '@/domain/entities/Message';

export type QuickRepliesItem = HelperItem & {
  type: 'quick_replies';
  options: HelperOption[];
};

export type ChoiceItem = HelperItem & {
  type: 'single_select' | 'multi_select';
  title: string;
  description?: string;
  options: HelperOption[];
  submitLabel?: string;
};

export type InputFormItem = HelperItem & {
  type: 'input_form';
  title: string;
  description?: string;
  fields: HelperField[];
  submitLabel?: string;
  cancelLabel?: string;
};

export type ConfirmItem = HelperItem & {
  type: 'confirm_action';
  title: string;
  description?: string;
  summary?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  reviseLabel?: string;
};

export type ArtifactItem = HelperItem & {
  type: 'artifact_suggestion';
  title: string;
  artifact?: { kind?: string; title?: string; content?: string; language?: string };
};

export type HelperActionPayload = {
  action: 'submit' | 'cancel' | 'revise' | 'quick_reply' | 'save_artifact';
  label?: string;
  value?: string;
  values?: Record<string, FormValue>;
};

export type SendHelperAction = (key: string, payload: HelperActionPayload) => Promise<void>;

export function isUsableHelperItem(item: HelperItem): boolean {
  if (item.type === 'quick_replies') return Array.isArray((item as { options?: unknown }).options);
  if (item.type === 'single_select' || item.type === 'multi_select') {
    return Array.isArray((item as { options?: unknown }).options);
  }
  if (item.type === 'input_form') return Array.isArray((item as { fields?: unknown }).fields);
  if (item.type === 'confirm_action') return true;
  if (item.type === 'artifact_suggestion') return typeof (item as ArtifactItem).artifact === 'object';
  return false;
}
