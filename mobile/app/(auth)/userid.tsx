/**
 * S-02′ · 사용자 ID 입력 (single-user onboarding — replaces phone/OTP login).
 * The user enters their Telegram user id (= chat_id). It's stored once and used as the
 * default conversation address for every bot, so sending works without a prior message.
 */
import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useAuthStore } from "@/application/stores/auth";
import { useBuddiesStore } from "@/application/stores/buddies";

export default function UserIdScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const setUserId = useAuthStore((s) => s.setUserId);
  const hydrateBuddies = useBuddiesStore((s) => s.hydrate);

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const digits = value.replace(/\D/g, "");
  const valid = digits.length >= 5; // Telegram user ids are long integers

  const handleStart = async () => {
    if (!valid || busy) return;
    setBusy(true);
    await setUserId(digits);
    await hydrateBuddies();
    router.replace("/buddies");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={{ padding: space[6], gap: space[5] }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space[2], marginTop: space[8] }}>
            <Text style={{ fontSize: 48 }}>💬</Text>
            <Text style={{ color: color("text-primary"), fontSize: fontSize["title-xl"], fontWeight: "700" }}>
              Agent Client
            </Text>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.body, lineHeight: 22 }}>
              시작하려면 텔레그램 사용자 ID를 입력하세요. 에이전트가 이 ID로 회신을 보냅니다.
            </Text>
          </View>

          <View style={{ gap: space[2] }}>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>
              사용자 ID (CHAT ID)
            </Text>
            <TextInput
              testID="userIdInput"
              value={value}
              onChangeText={setValue}
              placeholder="예: 6233568410"
              placeholderTextColor={color("text-secondary")}
              keyboardType="number-pad"
              autoFocus
              style={{
                backgroundColor: color("surface-elevated"),
                color: color("text-primary"),
                fontSize: fontSize["body-lg"],
                paddingHorizontal: space[4],
                paddingVertical: space[3],
                borderRadius: radius.lg,
                minHeight: touch.min,
              }}
            />
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>
              @userinfobot 에게 말을 걸면 본인의 숫자 ID를 알 수 있어요.
            </Text>
          </View>
        </ScrollView>

        <View style={{ paddingHorizontal: space[6], paddingTop: space[3], paddingBottom: space[6] }}>
          <Pressable
            testID="startButton"
            onPress={handleStart}
            disabled={!valid || busy}
            accessibilityRole="button"
            style={{
              backgroundColor: color(valid && !busy ? "primary" : "surface-elevated"),
              borderRadius: radius.full,
              paddingVertical: space[3],
              alignItems: "center",
              justifyContent: "center",
              minHeight: touch.min,
            }}
          >
            <Text
              style={{
                color: color(valid && !busy ? "on-primary" : "text-disabled"),
                fontSize: fontSize.body,
                fontWeight: "700",
              }}
            >
              {busy ? "시작 중…" : "시작하기"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
