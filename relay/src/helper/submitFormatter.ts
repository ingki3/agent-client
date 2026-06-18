import type { HelperSubmitBody } from "../types.js";

function trimText(value: unknown, max: number): unknown {
  if (typeof value !== "string") return value;
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function compactHelperSource(source: NonNullable<HelperSubmitBody["source"]>, mode: "normal" | "small" = "normal") {
  const textMax = mode === "small" ? 450 : 900;
  const recentTextMax = mode === "small" ? 120 : 260;
  return {
    messageId: source.messageId,
    text: trimText(source.text, textMax),
    excerpt: trimText(source.excerpt, 240),
    urls: source.urls?.slice(0, 3),
    handles: source.handles?.slice(0, 4),
    preview: source.preview
      ? {
          url: source.preview.url,
          title: trimText(source.preview.title, 160),
          description: trimText(source.preview.description, mode === "small" ? 120 : 240),
          siteName: source.preview.siteName,
        }
      : undefined,
    attachments: source.attachments?.slice(0, 3),
    recentMessages: source.recentMessages?.slice(mode === "small" ? -3 : -5).map((m) => ({
      messageId: m.messageId,
      role: m.role,
      text: trimText(m.text, recentTextMax),
      excerpt: trimText(m.excerpt, 160),
      urls: m.urls?.slice(0, 2),
      preview: m.preview ? { url: m.preview.url, title: trimText(m.preview.title, 120), siteName: m.preview.siteName } : undefined,
    })),
  };
}

export function helperSubmitText(body: HelperSubmitBody): string {
  const make = (source: unknown) => [
    "사용자가 아래 후속 액션을 선택했습니다.",
    "이 액션은 source 메시지의 대상/문맥에만 적용하세요.",
    "source.recentMessages가 있으면 전체 대화 맥락 복원에 참고하세요.",
    "",
    "```agent_helper_response",
    JSON.stringify(
      {
        helperItemId: body.helperItemId,
        helperType: body.helperType,
        action: body.action,
        label: body.label,
        value: body.value,
        values: body.values ?? {},
        source,
      },
      null,
      2,
    ),
    "```",
  ].join("\n");

  const normal = make(compactHelperSource(body.source ?? {}, "normal"));
  if (normal.length <= 3800) return normal;
  const small = make(compactHelperSource(body.source ?? {}, "small"));
  if (small.length <= 3800) return small;
  return make({
    messageId: body.source?.messageId,
    urls: body.source?.urls?.slice(0, 2),
    excerpt: trimText(body.source?.excerpt ?? body.source?.text, 180),
  }).slice(0, 3800);
}
