/**
 * S-04 · 2FA 클라우드 비밀번호 (MTProto 3단계, 선택). Shown only when the account has a
 * Two-Step Verification password set. On success → main app.
 */
import { useState } from "react";
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { fontSize, radius, space, touch } from "@/ui/theme/tokens";
import { useAuthStore } from "@/application/stores/auth";

export default function TwoFaScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const verify2fa = useAuthStore((s) => s.verify2fa);
  const pending = useAuthStore((s) => s.pending);
  const lastError = useAuthStore((s) => s.lastError);

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canSubmit = password.length > 0 && !pending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    const ok = await verify2fa(password);
    if (!ok) {
      const e = useAuthStore.getState().lastError;
      setError(e?.code === "invalid_password" ? "비밀번호가 올바르지 않습니다." : e?.message || "확인에 실패했습니다.");
      setPassword("");
      return;
    }
    router.replace("/(main)/buddies");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ flex: 1, padding: space[6], gap: space[5] }}>
          <View style={{ gap: space[2], marginTop: space[4] }}>
            <Text style={{ color: color("text-primary"), fontSize: fontSize["title-lg"], fontWeight: "700" }}>2단계 인증</Text>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>
              계정에 설정된 클라우드 비밀번호를 입력하세요.
            </Text>
          </View>

          <TextInput
            testID="twofaInput"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError(null);
            }}
            placeholder="클라우드 비밀번호"
            placeholderTextColor={color("text-secondary")}
            secureTextEntry
            autoFocus
            onSubmitEditing={handleSubmit}
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

          {error ? <Text style={{ color: color("error"), fontSize: fontSize["body-sm"] }}>{error}</Text> : null}

          <Pressable
            testID="twofaSubmit"
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            style={{
              backgroundColor: color(canSubmit ? "primary" : "surface-elevated"),
              borderRadius: radius.full,
              paddingVertical: space[3],
              alignItems: "center",
              justifyContent: "center",
              minHeight: touch.min,
            }}
          >
            <Text style={{ color: color(canSubmit ? "on-primary" : "text-disabled"), fontSize: fontSize.body, fontWeight: "700" }}>
              {pending ? "확인 중..." : "확인"}
            </Text>
          </Pressable>
          {lastError?.code === "network" ? (
            <Text style={{ color: color("error"), fontSize: fontSize["body-sm"] }}>
              relay 연결을 확인해 주세요.
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
