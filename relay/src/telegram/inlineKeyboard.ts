import type { InlineKeyboard, InlineKeyboardButton } from "../types.js";

function buttonStyle(label: string): InlineKeyboardButton["style"] {
  if (/삭제|취소|거절|중단|실패|delete|cancel|reject|stop/i.test(label)) return "danger";
  if (/확인|승인|완료|저장|선택|ok|confirm|approve|save|done/i.test(label)) return "success";
  return "default";
}

export function inlineButtonFromMtproto(button: any, row: number, col: number): InlineKeyboardButton {
  const label = String(button.text ?? "").trim() || "버튼";
  const id = `r${row}c${col}`;
  const className = String(button.className ?? "");
  if (className === "KeyboardButtonCallback") return { id, label, type: "callback", style: buttonStyle(label) };
  if (className === "KeyboardButtonUrl") return { id, label, type: "url", url: String(button.url ?? ""), style: "primary" };
  if (className === "KeyboardButtonWebView" || className === "KeyboardButtonSimpleWebView") {
    return { id, label, type: "web_app", url: String(button.url ?? ""), style: "primary" };
  }
  if (className === "KeyboardButtonUrlAuth") return { id, label, type: "login_url", url: String(button.url ?? ""), style: "primary" };
  if (className === "KeyboardButtonSwitchInline") return { id, label, type: "switch_inline", disabled: true };
  if (className === "KeyboardButtonCopy") return { id, label, type: "copy", copyText: String(button.copyText ?? label), style: "default" };
  return { id, label, type: "unsupported", disabled: true };
}

export function extractInlineKeyboard(markup: any): InlineKeyboard | undefined {
  if (!markup || String(markup.className ?? "") !== "ReplyInlineMarkup" || !Array.isArray(markup.rows)) return undefined;
  const rows = markup.rows
    .map((row: any, ri: number) => Array.isArray(row.buttons) ? row.buttons.map((b: any, ci: number) => inlineButtonFromMtproto(b, ri, ci)) : [])
    .filter((row: InlineKeyboardButton[]) => row.length > 0);
  return rows.length ? { rows } : undefined;
}
