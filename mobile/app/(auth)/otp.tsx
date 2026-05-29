/**
 * S-03 · SMS 코드 입력 (UC-01, FR-02/03). OTP autofill (iOS oneTimeCode / Android
 * sms-otp), countdown, resend + voice fallback, verify → AUTH. Verify failure shows an
 * inline reason (D-01 condensed).
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useAuthStore } from "@/application/stores/auth";
import { useBuddiesStore } from "@/application/stores/buddies";
import { AuthError } from "@/infrastructure/api/authClient";

const LENGTH = 6;
const EXPIRY = 300;

export default function OtpScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const phone = useAuthStore((s) => s.phone);
  const verifyCode = useAuthStore((s) => s.verifyCode);
  const sendCode = useAuthStore((s) => s.sendCode);
  const devMode = useAuthStore((s) => s.devMode);
  const devCodeHint = useAuthStore((s) => s.devCodeHint);
  const hydrateBuddies = useBuddiesStore((s) => s.hydrate);

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(EXPIRY);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const submit = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode(value);
      await hydrateBuddies();
      router.replace("/buddies");
    } catch (e) {
      const reason =
        e instanceof AuthError && e.reason === "expired"
          ? "코드가 만료되었습니다. 재전송해 주세요."
          : "코드가 올바르지 않습니다. 다시 입력해 주세요.";
      setError(reason);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const onChange = (t: string) => {
    const digits = t.replace(/\D/g, "").slice(0, LENGTH);
    setCode(digits);
    setError(null);
    if (digits.length === LENGTH) void submit(digits);
  };

  const resend = async (channel: "sms" | "voice") => {
    if (!phone) return;
    await sendCode(phone, channel);
    setRemaining(EXPIRY);
    setError(null);
    setCode("");
  };

  const mmss = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <View style={{ flex: 1, padding: space[6], gap: space[5] }}>
        <View style={{ gap: space[2], marginTop: space[4] }}>
          <Text style={{ color: color("text-primary"), fontSize: fontSize["title-lg"], fontWeight: "700" }}>인증 코드 입력</Text>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>
            {phone ?? "번호 미확인"} 로 보낸 {LENGTH}자리 코드를 입력하세요.
          </Text>
          {devMode ? (
            <Text style={{ color: color("info"), fontSize: fontSize["body-sm"] }}>
              DEV 코드: {devCodeHint} (또는 임의의 6자리)
            </Text>
          ) : null}
        </View>

        <Pressable testID="otpBoxes" onPress={() => inputRef.current?.focus()} style={{ flexDirection: "row", gap: space[2], justifyContent: "center" }}>
          {Array.from({ length: LENGTH }).map((_, i) => (
            <View
              key={i}
              style={{
                width: 46,
                height: 56,
                borderRadius: radius.lg,
                borderWidth: 1.5,
                borderColor: i === code.length ? color("primary") : color("border"),
                backgroundColor: color("surface-elevated"),
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: color("text-primary"), fontSize: fontSize["title-lg"], fontWeight: "700" }}>{code[i] ?? ""}</Text>
            </View>
          ))}
        </Pressable>

        <TextInput
          testID="otpInput"
          ref={inputRef}
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          autoFocus
          maxLength={LENGTH}
          style={{ position: "absolute", opacity: 0, height: 1, width: 1 }}
        />

        {error ? <Text style={{ color: color("error"), fontSize: fontSize["body-sm"], textAlign: "center" }}>{error}</Text> : null}

        <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"], textAlign: "center" }}>
          {remaining > 0 ? `남은 시간 ${mmss}` : "코드가 만료되었습니다."}
        </Text>

        <View style={{ flexDirection: "row", justifyContent: "center", gap: space[5] }}>
          <Pressable onPress={() => void resend("sms")} hitSlop={8} style={{ minHeight: touch.min, justifyContent: "center" }}>
            <Text style={{ color: color("primary"), fontSize: fontSize.body, fontWeight: "600" }}>재전송</Text>
          </Pressable>
          <Pressable onPress={() => void resend("voice")} hitSlop={8} style={{ minHeight: touch.min, justifyContent: "center" }}>
            <Text style={{ color: color("primary"), fontSize: fontSize.body, fontWeight: "600" }}>음성 통화로 받기</Text>
          </Pressable>
        </View>

        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: "center", minHeight: touch.min, justifyContent: "center" }}>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>번호 수정</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
