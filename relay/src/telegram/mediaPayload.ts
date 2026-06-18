import { Api } from "telegram";

const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/json": ".json",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "audio/m4a": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/csv": ".csv",
  "text/markdown": ".md",
  "text/plain": ".txt",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

export type NormalizedMediaKind = "document" | "image" | "video" | "voice" | "audio";

export function normalizeMediaKind(kind?: string, mime = "application/octet-stream"): NormalizedMediaKind {
  const lowerKind = String(kind ?? "").toLowerCase();
  const lowerMime = mime.toLowerCase();
  if (lowerKind === "voice") return "voice";
  if (lowerKind === "audio" || lowerMime.startsWith("audio/")) return "audio";
  if (lowerKind === "video" || lowerMime.startsWith("video/")) return "video";
  if (lowerKind === "image" || lowerMime.startsWith("image/")) return "image";
  return "document";
}

export function telegramSafeFileName(fileName?: string, mime = "application/octet-stream"): string {
  const trimmed = String(fileName || "file").trim().replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_");
  const base = trimmed || "file";
  if (/\.[A-Za-z0-9]{1,8}$/.test(base)) return base;
  const extension = MIME_EXTENSION[mime.toLowerCase()];
  return extension ? `${base}${extension}` : base;
}

export function telegramDocumentAttributes(params: {
  kind: NormalizedMediaKind;
  fileName: string;
}): Api.TypeDocumentAttribute[] | undefined {
  const { kind, fileName } = params;
  if (kind === "voice") {
    return [
      new Api.DocumentAttributeAudio({
        duration: 0,
        voice: true,
      }),
      new Api.DocumentAttributeFilename({ fileName }),
    ];
  }
  if (kind === "audio") {
    return [new Api.DocumentAttributeAudio({ duration: 0 }), new Api.DocumentAttributeFilename({ fileName })];
  }
  if (kind === "document") {
    return [new Api.DocumentAttributeFilename({ fileName })];
  }
  return undefined;
}
