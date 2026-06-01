/**
 * S-12 · 친구 추가 — 상대 @username 입력. The relay resolves the username via the user's
 * account (MTProto) and returns the peer; then routes to the preview step.
 */
import { useState } from "react";
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useBuddiesStore } from "@/application/stores/buddies";
import { useAddBuddyDraft } from "@/application/stores/addBuddyDraft";

export default function AddBuddyUsernameScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const preview = useBuddiesStore((s) => s.preview);
  const setDraft = useAddBuddyDraft((s) => s.set);

  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canNext = username.trim().replace(/^@/, "").length > 0 && !busy;

  const handleNext = async () => {
    if (!canNext) return;
    setBusy(true);
    setError(null);
    try {
      const peer = await preview(username);
      setDraft(peer);
      router.push("/add-buddy/preview");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("not signed in")) setError("로그인이 필요합니다.");
      else if (msg === "network") setError("네트워크 오류입니다. 릴레이 연결을 확인해 주세요.");
      else setError("사용자명을 찾을 수 없습니다. @username을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: "친구 추가",
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8} style={{ paddingHorizontal: space[2] }}>
              <Text style={{ color: color("primary"), fontSize: fontSize.body }}>닫기</Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ flex: 1, padding: space[5], gap: space[4] }}>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"], lineHeight: 20 }}>
            대화할 상대의 텔레그램 @username을 입력하세요. 내 계정으로 메시지를 보내며, 상대(봇)의 답장이 돌아옵니다.
          </Text>

          <View style={{ gap: space[2] }}>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>사용자명</Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: color("surface-elevated"),
                borderRadius: radius.lg,
                paddingHorizontal: space[4],
                minHeight: touch.min,
              }}
            >
              <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>@</Text>
              <TextInput
                testID="tokenInput"
                value={username.replace(/^@/, "")}
                onChangeText={(t) => {
                  setUsername(t);
                  setError(null);
                }}
                placeholder="myagent_bot"
                placeholderTextColor={color("text-secondary")}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                style={{ flex: 1, color: color("text-primary"), fontSize: fontSize.body, paddingVertical: space[3], paddingLeft: space[1] }}
              />
            </View>
          </View>

          {error ? <Text style={{ color: color("error"), fontSize: fontSize["body-sm"] }}>{error}</Text> : null}

          <Pressable
            testID="tokenNext"
            onPress={handleNext}
            disabled={!canNext}
            accessibilityRole="button"
            style={{
              backgroundColor: color(canNext ? "primary" : "surface-elevated"),
              borderRadius: radius.full,
              paddingVertical: space[3],
              alignItems: "center",
              minHeight: touch.min,
              justifyContent: "center",
            }}
          >
            <Text style={{ color: color(canNext ? "on-primary" : "text-disabled"), fontSize: fontSize.body, fontWeight: "700" }}>
              {busy ? "확인 중…" : "다음"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
