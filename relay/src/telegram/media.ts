export type MediaDescriptor = { kind: string; name: string; mime: string; size?: number };

export function classifyMedia(msg: any): MediaDescriptor | null {
  if (msg.photo) return { kind: "image", name: "photo.jpg", mime: "image/jpeg" };
  const doc = msg.document;
  if (!doc) return null;
  const mime: string = doc.mimeType || "application/octet-stream";
  const attrs: any[] = doc.attributes || [];
  const fileName = attrs.find((a) => a.className === "DocumentAttributeFilename")?.fileName;
  const audio = attrs.find((a) => a.className === "DocumentAttributeAudio");
  const isVideo = attrs.some((a) => a.className === "DocumentAttributeVideo");
  let kind = "document";
  if (mime.startsWith("image")) kind = "image";
  else if (mime.startsWith("video") || isVideo) kind = "video";
  else if (audio?.voice) kind = "voice";
  else if (mime.startsWith("audio") || audio) kind = "audio";
  const name = fileName || (kind === "video" ? "video.mp4" : kind === "voice" ? "voice.ogg" : kind === "image" ? "image.jpg" : "file");
  const size = doc.size != null ? Number(doc.size) : undefined;
  return { kind, name, mime, size };
}
