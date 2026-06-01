/**
 * S-04 · 2FA 클라우드 비밀번호 (MTProto 3단계, 선택). Shown only when the account has a
 * Two-Step Verification password set. On success → main app.
 */
import { useState } from "react";
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useAuthStore } from "@/application/stores/auth";
import { useBuddiesStore } from "@/application/stores/buddies";

export default function TwoFaScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const submit2fa = useAuthStore((s) => s.submit2fa);
  const hydrateBuddies = useBuddiesStore((s) => s.hydrate);

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = password.length > 0 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const ok = await submit2fa(password);
    setBusy(false);
    if (!ok) {
      const e = useAuthStore.getState().error;
      setError(e === "invalid_password" ? "비밀번호가 올바르지 않습니다." : "확인에 실패했습니다.");
      setPassword("");
      return;
    }
    await hydrateBuddies();
    router.replace("/buddies");
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
              {busy ? "확인 중…" : "확인"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
