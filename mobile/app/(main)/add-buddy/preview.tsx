/**
 * S-13 · 친구 추가 — 미리보기 / 확정 (UC-02, FR-05~08). Shows getMe metadata, lets the
 * user edit the display name, then creates the buddy (token → SecureStore). Duplicate
 * bot → D-03. After add, routes into the new chat.
 */
import { useState } from "react";
import { View, Text, TextInput, Pressable, Modal } from "react-native";
import { Stack, useRouter, Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useBuddiesStore } from "@/application/stores/buddies";
import { useAddBuddyDraft } from "@/application/stores/addBuddyDraft";
import { Avatar } from "@/components/Avatar";
import type { Buddy } from "@/domain/entities";

export default function AddBuddyPreviewScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const token = useAddBuddyDraft((s) => s.token);
  const meta = useAddBuddyDraft((s) => s.meta);
  const clearDraft = useAddBuddyDraft((s) => s.clear);
  const add = useBuddiesStore((s) => s.add);

  const [displayName, setDisplayName] = useState(meta?.first_name ?? "");
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<Buddy | null>(null);

  if (!token || !meta) return <Redirect href="/add-buddy/token" />;

  const handleAdd = async () => {
    if (busy) return;
    setBusy(true);
    const result = await add(token, meta, displayName);
    setBusy(false);
    if ("duplicateOf" in result) {
      setDuplicate(result.duplicateOf);
      return;
    }
    clearDraft();
    router.dismissAll();
    router.replace(`/chat/${result.id}`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <Stack.Screen options={{ title: "미리보기" }} />
      <View style={{ flex: 1, padding: space[5], gap: space[5] }}>
        <View style={{ alignItems: "center", gap: space[3], marginTop: space[4] }}>
          <Avatar name={meta.first_name} accent="accent-buddy-1" size={72} />
          <Text style={{ color: color("text-primary"), fontSize: fontSize["title-md"], fontWeight: "700" }}>{meta.first_name}</Text>
          {meta.username ? <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>@{meta.username}</Text> : null}
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>Telegram 호환 봇 · ID {meta.id}</Text>
        </View>

        <View style={{ gap: space[2] }}>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>표시 이름</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={meta.first_name}
            placeholderTextColor={color("text-secondary")}
            style={{
              backgroundColor: color("surface-elevated"),
              color: color("text-primary"),
              fontSize: fontSize.body,
              paddingHorizontal: space[4],
              paddingVertical: space[3],
              borderRadius: radius.lg,
              minHeight: touch.min,
            }}
          />
        </View>

        <View style={{ flex: 1 }} />

        <Pressable
          testID="confirmAdd"
          onPress={handleAdd}
          disabled={busy}
          accessibilityRole="button"
          style={{
            backgroundColor: color("primary"),
            borderRadius: radius.full,
            paddingVertical: space[3],
            alignItems: "center",
            minHeight: touch.min,
            justifyContent: "center",
          }}
        >
          <Text style={{ color: color("on-primary"), fontSize: fontSize.body, fontWeight: "700" }}>{busy ? "추가 중…" : "추가"}</Text>
        </Pressable>
      </View>

      {/* D-03 · 친구 중복 경고 */}
      <Modal visible={duplicate !== null} transparent animationType="fade" onRequestClose={() => setDuplicate(null)}>
        <View style={{ flex: 1, backgroundColor: "#00000088", alignItems: "center", justifyContent: "center", padding: space[6] }}>
          <View style={{ backgroundColor: color("surface"), borderRadius: radius.xl, padding: space[5], gap: space[4], width: "100%", maxWidth: 360 }}>
            <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700" }}>이미 등록된 봇이에요</Text>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>
              "{duplicate?.displayName}" 으로 이미 등록되어 있습니다.
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[4] }}>
              <Pressable onPress={() => setDuplicate(null)} style={{ minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[3] }}>
                <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>취소</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const open = duplicate;
                  setDuplicate(null);
                  clearDraft();
                  if (open) {
                    router.dismissAll();
                    router.replace(`/chat/${open.id}`);
                  }
                }}
                style={{ minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[3] }}
              >
                <Text style={{ color: color("primary"), fontSize: fontSize.body, fontWeight: "700" }}>기존 친구 열기</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
