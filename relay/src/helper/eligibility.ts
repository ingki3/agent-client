import { looksCompleteForHelper } from "../messageText.js";

export function helperEligibleText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 20) return false;
  if (/^[.…·\-\s]+$/.test(trimmed)) return false;
  if (/^📚\s*skill_view:/i.test(trimmed)) return false;
  if (/^(?:진행 상황|🛠|💻|Transcript:)/i.test(trimmed)) return false;
  if (!looksCompleteForHelper(trimmed)) return false;
  return true;
}
