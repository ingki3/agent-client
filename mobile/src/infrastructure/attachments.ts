/**
 * Attachment pickers (Expo): documents, photos/videos (library + camera), voice recording,
 * and location. Each returns a normalized `PickedAttachment` (or null if cancelled). The
 * caller reads `readBase64(uri)` to upload via the relay's /sendMedia.
 */
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system";
import { Audio } from "expo-av";
import type { AttachmentKind } from "@/domain/entities";

export type PickedAttachment = {
  kind: AttachmentKind;
  uri: string;
  name: string;
  mime: string;
  size?: number;
  durationMs?: number;
};

function nameFromUri(uri: string, fallback: string): string {
  const last = uri.split("/").pop();
  return last && last.includes(".") ? decodeURIComponent(last) : fallback;
}

/** Any files: text, pdf, docx, pptx, xlsx, … (multi-select). */
export async function pickDocument(): Promise<PickedAttachment[]> {
  const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: true });
  if (res.canceled || !res.assets?.length) return [];
  return res.assets.map((a) => ({
    kind: "document" as const,
    uri: a.uri,
    name: a.name ?? nameFromUri(a.uri, "file"),
    mime: a.mimeType ?? "application/octet-stream",
    size: a.size ?? undefined,
  }));
}

/** Photos/videos from the library (multi-select). */
export async function pickMedia(): Promise<PickedAttachment[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    allowsMultipleSelection: true,
    selectionLimit: 10,
    quality: 0.8,
  });
  if (res.canceled) return [];
  return (res.assets ?? []).map(mapImageAsset);
}

/** Capture a single photo or video with the camera. */
export async function captureCamera(): Promise<PickedAttachment | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.8 });
  if (res.canceled || !res.assets?.[0]) return null;
  return mapImageAsset(res.assets[0]);
}

function mapImageAsset(a: ImagePicker.ImagePickerAsset): PickedAttachment {
  const isVideo = a.type === "video";
  return {
    kind: isVideo ? "video" : "image",
    uri: a.uri,
    name: a.fileName ?? nameFromUri(a.uri, isVideo ? "video.mp4" : "photo.jpg"),
    mime: a.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg"),
    size: a.fileSize ?? undefined,
    durationMs: a.duration ?? undefined,
  };
}

/** Current location → a Google Maps URL (sent as a normal message → link preview card). */
export async function getLocationUrl(): Promise<string | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    // Last-known is instant and avoids a GPS-fix hang indoors; fall back to a fresh fix.
    let pos = await Location.getLastKnownPositionAsync();
    if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    if (!pos) return null;
    const { latitude, longitude } = pos.coords;
    return `https://www.google.com/maps?q=${latitude},${longitude}`;
  } catch {
    return null;
  }
}

/** Read a local file as base64 for upload. */
export function readBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

// ─── Voice recording ─────────────────────────────────────────────────────────
let recording: Audio.Recording | null = null;

export async function startRecording(): Promise<boolean> {
  const perm = await Audio.requestPermissionsAsync();
  if (!perm.granted) return false;
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const rec = new Audio.Recording();
  await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await rec.startAsync();
  recording = rec;
  return true;
}

/** Stop recording and return the voice attachment (or null if nothing was recorded). */
export async function stopRecording(): Promise<PickedAttachment | null> {
  const rec = recording;
  recording = null;
  if (!rec) return null;
  try {
    await rec.stopAndUnloadAsync();
  } catch {
    return null;
  }
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  const uri = rec.getURI();
  if (!uri) return null;
  const status = await rec.getStatusAsync().catch(() => null);
  return {
    kind: "voice",
    uri,
    name: "voice.m4a",
    mime: "audio/m4a",
    durationMs: status && "durationMillis" in status ? (status.durationMillis ?? undefined) : undefined,
  };
}

export async function cancelRecording(): Promise<void> {
  const rec = recording;
  recording = null;
  if (rec) await rec.stopAndUnloadAsync().catch(() => undefined);
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined);
}
