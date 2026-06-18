import type { InlineKeyboardButton } from '@/domain/entities/Message';

export function formatMessageTime(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function tgMessageId(id: string | null): number | undefined {
  if (!id) return undefined;
  if (/^\d+$/.test(id)) return Number(id);
  const m = id.match(/^tg-(\d+)$/);
  return m ? Number(m[1]) : undefined;
}

export function buttonStyle(label: string): InlineKeyboardButton['style'] {
  if (/삭제|취소|거절|중단|실패|delete|cancel|reject|stop/i.test(label)) return 'danger';
  if (/확인|승인|완료|저장|선택|ok|confirm|approve|save|done/i.test(label)) return 'success';
  return 'default';
}
