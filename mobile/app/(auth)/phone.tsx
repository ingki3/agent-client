/**
 * S-02 · 전화번호 입력 (UC-01, FR-01). Telegram-standard phone entry: country code +
 * national number → E.164, terms consent, then `send-code`. In dev mode (no gateway)
 * any valid-looking number proceeds and the OTP screen shows the dev code hint.
 */
import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView } from "react-native";
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

export default function PhoneScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const sendCode = useAuthStore((s) => s.sendCode);
  const devMode = useAuthStore((s) => s.devMode);

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
    try {
      await sendCode(e164);
      router.push("/otp");
    } catch (e) {
      console.warn("[phone] sendCode/navigate failed:", e);
      setError("코드 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }}>
      <ScrollView contentContainerStyle={{ padding: space[6], gap: space[5], flexGrow: 1 }}>
        <View style={{ gap: space[2], marginTop: space[6] }}>
          <Text style={{ fontSize: 48 }}>💬</Text>
          <Text style={{ color: color("text-primary"), fontSize: fontSize["title-xl"], fontWeight: "700" }}>전화번호 입력</Text>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.body, lineHeight: 22 }}>
            인증 코드를 SMS로 보내드려요. 번호는 인증 목적으로만 사용됩니다.
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: space[2] }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], flex: 1 }}>
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

        {devMode ? (
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>
            DEV 모드 — 게이트웨이 미설정. 임의 번호로 진행되며 인증 코드는 다음 화면에 안내됩니다.
          </Text>
        ) : null}

        <View style={{ flex: 1 }} />

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
      </ScrollView>
    </SafeAreaView>
  );
}
