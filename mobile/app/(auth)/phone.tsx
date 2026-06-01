/**
 * S-02 · 전화번호 입력 (MTProto 로그인 1단계). Country code + national number → E.164,
 * terms consent, then request a login code via the relay's user-account auth. The code is
 * delivered in your Telegram app (MTProto), not SMS.
 */
import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useAuthStore } from "@/application/stores/auth";

const COUNTRIES = [
  { code: "+82", label: "🇰🇷 +82" },
  { code: "+1", label: "🇺🇸 +1" },
  { code: "+81", label: "🇯🇵 +81" },
  { code: "+44", label: "🇬🇧 +44" },
  { code: "+86", label: "🇨🇳 +86" },
];

function messageFor(error: string | null): string | null {
  if (!error) return null;
  if (error === "network") return "네트워크 오류입니다. 릴레이 연결을 확인해 주세요.";
  if (error === "no_relay") return "릴레이가 설정되지 않았습니다 (app.json relayBase).";
  if (error === "mtproto_disabled") return "서버에 MTProto 자격증명이 설정되지 않았습니다.";
  if (error === "flood_wait") return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
  return "코드 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

export default function PhoneScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const startLogin = useAuthStore((s) => s.startLogin);

  const [cc, setCc] = useState("+82");
  const [number, setNumber] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const digits = number.replace(/\D/g, "").replace(/^0/, "");
  const e164 = `${cc}${digits}`;
  const valid = digits.length >= 8 && agree;

  const handleNext = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const ok = await startLogin(e164);
    setBusy(false);
    if (ok) router.push("/code");
    else setError(messageFor(useAuthStore.getState().error));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: space[6], gap: space[5] }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space[2], marginTop: space[6] }}>
            <Text style={{ fontSize: 48 }}>💬</Text>
            <Text style={{ color: color("text-primary"), fontSize: fontSize["title-xl"], fontWeight: "700" }}>전화번호 입력</Text>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.body, lineHeight: 22 }}>
              내 텔레그램 계정으로 로그인합니다. 인증 코드는 텔레그램 앱으로 전송돼요.
            </Text>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {COUNTRIES.map((c) => {
              const selected = c.code === cc;
              return (
                <Pressable
                  key={c.code}
                  onPress={() => setCc(c.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={{
                    paddingHorizontal: space[3],
                    paddingVertical: space[2],
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: selected ? color("primary") : color("border"),
                    backgroundColor: selected ? color("trace-summary") : color("surface"),
                  }}
                >
                  <Text style={{ color: color(selected ? "on-trace-summary" : "text-primary"), fontSize: fontSize["body-sm"] }}>
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            testID="phoneInput"
            value={number}
            onChangeText={(t) => {
              setNumber(t);
              setError(null);
            }}
            placeholder="10-1234-5678"
            placeholderTextColor={color("text-secondary")}
            keyboardType="phone-pad"
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

          {error ? <Text style={{ color: color("error"), fontSize: fontSize["body-sm"] }}>{error}</Text> : null}

          <Pressable
            testID="agreeToggle"
            onPress={() => setAgree((a) => !a)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agree }}
            style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
          >
            <Text style={{ fontSize: fontSize["title-sm"], color: color(agree ? "primary" : "text-secondary") }}>
              {agree ? "☑" : "☐"}
            </Text>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"], flex: 1 }}>
              이용약관 및 개인정보 처리방침에 동의합니다.
            </Text>
          </Pressable>
        </ScrollView>

        <View style={{ paddingHorizontal: space[6], paddingTop: space[3], paddingBottom: space[6] }}>
          <Pressable
            testID="nextButton"
            onPress={handleNext}
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
            <Text style={{ color: color(valid && !busy ? "on-primary" : "text-disabled"), fontSize: fontSize.body, fontWeight: "700" }}>
              {busy ? "전송 중…" : "다음"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
