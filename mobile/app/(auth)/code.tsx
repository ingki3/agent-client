/**
 * S-03 · 로그인 코드 입력 (MTProto 2단계). The code is delivered in your Telegram app.
 * On success → main app; if the account has a 2FA cloud password → /twofa.
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useAuthStore } from "@/application/stores/auth";

const LENGTH = 5; // Telegram login codes are 5 digits
const EXPIRY = 300;

export default function CodeScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const phone = useAuthStore((s) => s.phoneE164);
  const submitCode = useAuthStore((s) => s.verifyCode);

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
    const ok = await submitCode(value);
    setBusy(false);
    if (!ok) {
      const e = useAuthStore.getState().lastError?.code;
      setError(e === "invalid_code" ? "코드가 올바르지 않습니다." : e === "code_expired" ? "코드가 만료되었습니다. 번호를 수정해 다시 받아주세요." : "확인에 실패했습니다.");
      setCode("");
      return;
    }
    const st = useAuthStore.getState().status;
    if (st === "awaiting_2fa") {
      router.replace("/twofa");
    } else {
      router.replace("/buddies");
    }
  };

  const onChange = (t: string) => {
    const digits = t.replace(/\D/g, "").slice(0, LENGTH);
    setCode(digits);
    setError(null);
    if (digits.length === LENGTH) void submit(digits);
  };

  const mmss = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <View style={{ flex: 1, padding: space[6], gap: space[5] }}>
        <View style={{ gap: space[2], marginTop: space[4] }}>
          <Text style={{ color: color("text-primary"), fontSize: fontSize["title-lg"], fontWeight: "700" }}>인증 코드 입력</Text>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>
            {phone ?? "번호 미확인"} · 텔레그램 앱으로 받은 {LENGTH}자리 코드를 입력하세요.
          </Text>
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
          autoFocus
          maxLength={LENGTH}
          style={{ position: "absolute", opacity: 0, height: 1, width: 1 }}
        />

        {error ? <Text style={{ color: color("error"), fontSize: fontSize["body-sm"], textAlign: "center" }}>{error}</Text> : null}

        <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"], textAlign: "center" }}>
          {remaining > 0 ? `남은 시간 ${mmss}` : "코드가 만료되었습니다."}
        </Text>

        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: "center", minHeight: touch.min, justifyContent: "center" }}>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>번호 수정</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
