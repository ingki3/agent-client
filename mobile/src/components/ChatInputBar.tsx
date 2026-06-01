import { useState } from "react";
import { View, TextInput, Pressable, Text, Modal, Image, ScrollView } from "react-native";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import {
  pickDocument,
  pickMedia,
  captureCamera,
  getLocationUrl,
  startRecording,
  stopRecording,
  cancelRecording,
  type PickedAttachment,
} from "@/infrastructure/attachments";

const MAX_ATTACHMENTS = 10;

// Everything you can attach is staged the same way: a file or a location. The staged list is
// previewed above the composer; on send each item becomes one message (caption on the first).
type Staged = { type: "file"; file: PickedAttachment } | { type: "location"; url: string };

export function ChatInputBar({
  onSend,
  onAttachMany,
  placeholder = "메시지 보내기",
}: {
  onSend: (text: string) => void;
  onAttachMany: (items: PickedAttachment[], caption: string) => void;
  placeholder?: string;
}) {
  const { color } = useTheme();
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<Staged[]>([]);

  const canSend = value.trim().length > 0 || pending.length > 0;

  const handleSend = () => {
    if (pending.length > 0) {
      const files = pending.filter((p) => p.type === "file").map((p) => (p as { file: PickedAttachment }).file);
      const media = files.filter((f) => f.kind === "image" || f.kind === "video");
      const docs = files.filter((f) => f.kind === "document");
      const audios = files.filter((f) => f.kind === "voice" || f.kind === "audio");
      const locs = pending.filter((p) => p.type === "location").map((p) => (p as { url: string }).url);

      // Locations are text — fold their links into the message content (the caption) rather
      // than a separate bubble. Combine with the typed caption.
      const locText = locs.map((u) => `[📍 내 위치 (지도)](${u})`).join("\n");
      const fullCaption = [value.trim(), locText].filter(Boolean).join("\n");

      let used = false;
      const nextCap = () => {
        if (used) return "";
        used = true;
        return fullCaption; // caption (incl. locations) rides on the first group only
      };

      // Fewest bubbles Telegram allows: photos/videos album, documents group, voices individually.
      if (media.length) onAttachMany(media, nextCap());
      if (docs.length) onAttachMany(docs, nextCap());
      audios.forEach((a) => onAttachMany([a], nextCap()));
      // No files consumed the caption → send the text (caption + locations) as its own message.
      if (!used && fullCaption) onSend(fullCaption);

      setPending([]);
      setValue("");
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  const addStaged = (items: Staged[]) => setPending((prev) => [...prev, ...items].slice(0, MAX_ATTACHMENTS));

  // Run a picker after the menu closes; results are staged (not sent) so a caption can be added.
  const runPicker = (pick: () => Promise<PickedAttachment[] | PickedAttachment | null>) => {
    setMenuOpen(false);
    setTimeout(async () => {
      const res = await pick().catch(() => null);
      if (!res) return;
      const files = Array.isArray(res) ? res : [res];
      addStaged(files.map((file) => ({ type: "file", file })));
    }, 250);
  };

  const addLocation = () => {
    setMenuOpen(false);
    setTimeout(async () => {
      const url = await getLocationUrl().catch(() => null);
      if (url) addStaged([{ type: "location", url }]);
    }, 250);
  };

  const toggleRecord = async () => {
    if (recording) {
      setRecording(false);
      const voice = await stopRecording().catch(() => null);
      if (voice) addStaged([{ type: "file", file: voice }]);
    } else {
      const ok = await startRecording().catch(() => false);
      if (ok) setRecording(true);
    }
  };

  const abortRecord = async () => {
    setRecording(false);
    await cancelRecording().catch(() => undefined);
  };

  const removeAt = (i: number) => setPending((prev) => prev.filter((_, idx) => idx !== i));

  const fileIcon = (kind: PickedAttachment["kind"]) =>
    kind === "video" ? "🎬" : kind === "voice" ? "🎙️" : kind === "audio" ? "🎵" : "📄";
  const stagedLabel = (s: Staged) => (s.type === "location" ? "내 위치" : s.file.name);

  const MenuRow = ({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[5],
        paddingVertical: space[4],
        minHeight: touch.min,
        backgroundColor: pressed ? color("surface-elevated") : color("surface"),
      })}
    >
      <Text style={{ fontSize: fontSize["title-md"] }}>{icon}</Text>
      <Text style={{ color: color("text-primary"), fontSize: fontSize.body }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ backgroundColor: color("surface"), borderTopWidth: 1, borderTopColor: color("border") }}>
      {/* Staged items — horizontal previews, each removable. */}
      {pending.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: space[2], paddingHorizontal: space[4], paddingTop: space[3] }}
        >
          {pending.map((item, i) => (
            <View key={`${i}-${stagedLabel(item)}`} style={{ width: 64 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: radius.md,
                  backgroundColor: color("surface-elevated"),
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {item.type === "file" && item.file.kind === "image" ? (
                  <Image source={{ uri: item.file.uri }} style={{ width: 64, height: 64 }} />
                ) : (
                  <Text style={{ fontSize: fontSize["title-lg"] }}>
                    {item.type === "location" ? "📍" : fileIcon(item.file.kind)}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => removeAt(i)}
                hitSlop={6}
                accessibilityLabel="첨부 제거"
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 20,
                  height: 20,
                  borderRadius: radius.full,
                  backgroundColor: color("surface"),
                  borderWidth: 1,
                  borderColor: color("border"),
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: color("text-primary"), fontSize: fontSize.caption, fontWeight: "700" }}>✕</Text>
              </Pressable>
              <Text style={{ color: color("text-secondary"), fontSize: 9, marginTop: 2 }} numberOfLines={1}>
                {stagedLabel(item)}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: space[2],
          paddingHorizontal: space[3],
          paddingTop: space[2],
          paddingBottom: space[3],
        }}
      >
        {recording ? (
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[2] }}>
            <Pressable onPress={abortRecord} hitSlop={8} accessibilityLabel="녹음 취소">
              <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>✕</Text>
            </Pressable>
            <View style={{ width: 10, height: 10, borderRadius: radius.full, backgroundColor: color("error") }} />
            <Text style={{ flex: 1, color: color("text-primary"), fontSize: fontSize.body }}>녹음 중… 탭하여 첨부</Text>
          </View>
        ) : (
          <>
            <Pressable
              testID="attachButton"
              onPress={() => setMenuOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="첨부"
              style={{
                width: touch.min,
                height: touch.min,
                borderRadius: radius.full,
                backgroundColor: color("surface-elevated"),
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: fontSize["title-sm"] }}>＋</Text>
            </Pressable>

            <View
              style={{
                flex: 1,
                backgroundColor: color("surface-elevated"),
                borderRadius: radius.xl,
                paddingHorizontal: space[4],
                paddingVertical: space[2],
                minHeight: touch.min,
                justifyContent: "center",
              }}
            >
              <TextInput
                testID="chatInput"
                value={value}
                onChangeText={setValue}
                placeholder={pending.length > 0 ? "설명 추가 (선택)" : placeholder}
                placeholderTextColor={color("text-secondary")}
                multiline
                style={{ color: color("text-primary"), fontSize: fontSize.body, paddingVertical: 0, maxHeight: 120 }}
                onSubmitEditing={handleSend}
                blurOnSubmit={false}
              />
            </View>
          </>
        )}

        <Pressable
          testID={canSend ? "chatSend" : "voiceButton"}
          onPress={canSend ? handleSend : toggleRecord}
          accessibilityRole="button"
          accessibilityLabel={canSend ? "전송" : recording ? "녹음 정지 후 첨부" : "음성 녹음"}
          style={{
            width: touch.min,
            height: touch.min,
            borderRadius: radius.full,
            backgroundColor: color(canSend || recording ? "primary" : "surface-elevated"),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: color(canSend || recording ? "on-primary" : "text-disabled"),
              fontSize: fontSize["title-sm"],
              fontWeight: "700",
            }}
          >
            {canSend ? "↑" : recording ? "■" : "🎙️"}
          </Text>
        </Pressable>
      </View>

      {/* Attachment menu */}
      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <Pressable
          accessible={false}
          onPress={() => setMenuOpen(false)}
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" }}
        >
          <Pressable
            accessible={false}
            style={{
              backgroundColor: color("surface"),
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingVertical: space[2],
              paddingBottom: space[6],
            }}
          >
            <View style={{ alignItems: "center", paddingVertical: space[2] }}>
              <View style={{ width: 40, height: 4, borderRadius: radius.full, backgroundColor: color("border") }} />
            </View>
            <MenuRow icon="🖼️" label="사진 / 동영상" onPress={() => runPicker(pickMedia)} />
            <MenuRow icon="📷" label="카메라" onPress={() => runPicker(captureCamera)} />
            <MenuRow icon="📎" label="파일" onPress={() => runPicker(pickDocument)} />
            <MenuRow icon="📍" label="위치" onPress={addLocation} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
