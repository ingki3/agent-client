/**
 * S-12 · 친구 추가 — 봇 토큰 입력 (UC-02, FR-05). `getMe` validates the token and
 * fetches metadata, then routes to the preview step. Invalid token → inline error.
 */
import { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useBuddiesStore } from "@/application/stores/buddies";
import { useAddBuddyDraft } from "@/application/stores/addBuddyDraft";
import { BotApiError } from "@/infrastructure/api/telegramBotApi";

export default function AddBuddyTokenScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const preview = useBuddiesStore((s) => s.preview);
  const setDraft = useAddBuddyDraft((s) => s.set);

  const [token, setToken] = useState("");
  const [masked, setMasked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canNext = token.trim().length > 0 && !busy;

  const handleNext = async () => {
    if (!canNext) return;
    setBusy(true);
    setError(null);
    try {
      const meta = await preview(token);
      setDraft(token.trim(), meta);
      router.push("/add-buddy/preview");
    } catch (e) {
      if (e instanceof BotApiError && e.code === 401) setError("유효하지 않은 토큰입니다.");
      else if (e instanceof Error && e.message.includes("봇")) setError(e.message);
      else setError("토큰을 확인할 수 없습니다. 네트워크와 토큰을 확인해 주세요.");
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
      <View style={{ flex: 1, padding: space[5], gap: space[4] }}>
        <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"], lineHeight: 20 }}>
          텔레그램 봇 토큰을 입력하세요. 기본 게이트웨이는 공개 Telegram Bot API이며, 실제 봇과 즉시 대화할 수 있습니다.
        </Text>

        <View style={{ gap: space[2] }}>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>봇 토큰</Text>
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
            <TextInput
              testID="tokenInput"
              value={token}
              onChangeText={(t) => {
                setToken(t);
                setError(null);
              }}
              placeholder="123456789:ABC-DEF..."
              placeholderTextColor={color("text-secondary")}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={masked}
              style={{ flex: 1, color: color("text-primary"), fontSize: fontSize.body, paddingVertical: space[3] }}
            />
            <Pressable onPress={() => setMasked((m) => !m)} hitSlop={8} style={{ paddingLeft: space[2] }}>
              <Text style={{ color: color("primary"), fontSize: fontSize["body-sm"] }}>{masked ? "표시" : "숨김"}</Text>
            </Pressable>
          </View>
        </View>

        {error ? <Text style={{ color: color("error"), fontSize: fontSize["body-sm"] }}>{error}</Text> : null}

        <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>
          토큰은 @BotFather에서 발급받을 수 있습니다. 토큰은 기기 SecureStore에만 저장됩니다.
        </Text>

        <View style={{ flex: 1 }} />

        <Pressable
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
    </SafeAreaView>
  );
}
