export function looksCompleteForHelper(text: string): boolean {
  const trimmed = text.trim();
  const lastLine = (trimmed.split("\n").filter((line) => line.trim()).pop() ?? trimmed).trim();
  const trailingDecoration = String.raw`[\s\p{Extended_Pictographic}\uFE0E\uFE0F\u200D]*`;
  if (new RegExp(`[.!?。！？…]${trailingDecoration}$`, "u").test(lastLine)) return true;
  if (
    new RegExp(`[)\\]}"'”’]${trailingDecoration}$`, "u").test(lastLine) &&
    new RegExp(`[.!?。！？…][)\\]}"'”’]*${trailingDecoration}$`, "u").test(lastLine)
  ) {
    return true;
  }
  if (new RegExp(`(?:습니다|합니다|입니다|됩니다|해주세요|주세요|해요|이에요|예요|네요|군요|죠|까요|됩니다|완료했습니다|정리했습니다)${trailingDecoration}$`, "u").test(lastLine)) return true;
  if (/^(```|---|\*\s+\S|-\s+\S|\d+[.)]\s+\S)/m.test(trimmed) && trimmed.length > 600) return true;
  if (trimmed.length >= 1200 && new RegExp(`(?:다|요|죠|함|됨|음)${trailingDecoration}$`, "u").test(lastLine)) return true;
  return false;
}
