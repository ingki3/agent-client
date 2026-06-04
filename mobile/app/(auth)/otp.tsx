/**
 * S-03 · Telegram 로그인 코드 입력 (TECH §3.5).
 *
 * Features:
 * - OTP autofill (iOS textContentType="oneTimeCode", Android autoComplete="sms-otp")
 * - 카운트다운 (codeExpiresAt) — 만료 시 입력 비활성 + 재전송 강조
 * - D-01 inline dialog for invalid/expired with retry / resend
 * - On success: protected-route effect in app/_layout.tsx redirects to "/"
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { fontSize, radius, space, touch } from "@/ui/theme/tokens";
import { useAuthStore } from "@/application/stores/auth";
import { maskE164 } from "@/domain/value-objects/phone";
import { config } from "@/infrastructure/config";

const CODE_LENGTH = config.relayBase ? 5 : 6;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function OtpScreen() {
  const { color } = useTheme();
  const router = useRouter();

  const phone = useAuthStore((s) => s.phoneE164);
  const requestId = useAuthStore((s) => s.requestId);
  const codeExpiresAt = useAuthStore((s) => s.codeExpiresAt);
  const pending = useAuthStore((s) => s.pending);
  const lastError = useAuthStore((s) => s.lastError);
  const verifyCode = useAuthStore((s) => s.verifyCode);
  const resendCode = useAuthStore((s) => s.resendCode);
  const clearError = useAuthStore((s) => s.clearError);

  const [code, setCode] = useState("");
  const [dialog, setDialog] = useState<null | "invalid" | "expired">(null);
  const inputRef = useRef<TextInput | null>(null);

  // Tick once a second for countdown.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!codeExpiresAt) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [codeExpiresAt]);

  useEffect(() => {
    if (!requestId) {
      // We arrived without an active code request → back to phone entry.
      router.replace("/(auth)/phone");
    }
  }, [requestId, router]);

  useEffect(() => {
    // Focus input on mount.
    const id = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (lastError?.code === "code_expired") setDialog("expired");
    else if (lastError?.code === "invalid_code") setDialog("invalid");
  }, [lastError]);

  const remainingMs = codeExpiresAt ? codeExpiresAt - Date.now() : 0;
  const expired = remainingMs <= 0;
  const canSubmit = code.length === CODE_LENGTH && !pending && !expired;

  const submitCode = async (value: string) => {
    const ok = await verifyCode(value);
    if (!ok) return;
    const status = useAuthStore.getState().status;
    if (status === "awaiting_2fa") {
      router.replace("/(auth)/twofa");
      return;
    }
    setCode("");
  };

  const handleChange = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH && !pending && !expired) {
      void submitCode(digits);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await submitCode(code);
  };

  const handleResend = async (channel: "sms" | "voice" = "sms") => {
    setCode("");
    setDialog(null);
    clearError();
    await resendCode(channel);
  };

  const cells = useMemo(
    () =>
      Array.from({ length: CODE_LENGTH }, (_, i) => {
        const ch = code[i] ?? "";
        const focused = i === code.length;
        return { ch, focused };
      }),
    [code],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <Stack.Screen options={{ title: "인증번호 입력" }} />
      <View style={{ flex: 1, padding: space[6], gap: space[5] }}>
        <View style={{ gap: space[2] }}>
          <Text
            style={{
              color: color("text-primary"),
              fontSize: fontSize["title-lg"],
              fontWeight: "700",
            }}
          >
            인증번호를 입력해 주세요
          </Text>
          <Text
            style={{
              color: color("text-secondary"),
              fontSize: fontSize.body,
              lineHeight: 22,
            }}
          >
            {phone
              ? `${maskE164(phone)} Telegram 계정으로 보낸 ${CODE_LENGTH}자리 코드`
              : "Telegram 앱으로 보낸 코드를 입력해 주세요"}
          </Text>
        </View>

        {/*
          iOS surfaces the OTP autofill QuickType chip only when the focused
          TextInput has a visible-sized on-screen frame; a 1×1 / opacity:0 field
          is detected but the chip is suppressed (BIZ-292). Overlay the input
          on top of the 6-cell row so its frame matches the visual cells while
          remaining transparent to the user.
        */}
        <View style={{ position: "relative" }}>
          <Pressable
            onPress={() => inputRef.current?.focus()}
            accessibilityRole="button"
            accessibilityLabel="인증번호 입력"
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              gap: space[2],
            }}
          >
            {cells.map((cell, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  aspectRatio: 1,
                  borderWidth: 1.5,
                  borderColor: color(cell.focused ? "primary" : "border-strong"),
                  borderRadius: radius.md,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: color("surface-elevated"),
                }}
              >
                <Text
                  style={{
                    color: color("text-primary"),
                    fontSize: fontSize["title-lg"],
                    fontWeight: "700",
                  }}
                >
                  {cell.ch}
                </Text>
              </View>
            ))}
          </Pressable>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={handleChange}
            onSubmitEditing={handleSubmit}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            importantForAutofill="yes"
            maxLength={CODE_LENGTH}
            editable={!expired}
            caretHidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              opacity: 0.01,
              color: "transparent",
            }}
            accessibilityLabel="인증번호 입력 필드"
          />
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text
            style={{
              color: color(expired ? "error" : "text-secondary"),
              fontSize: fontSize["body-sm"],
            }}
          >
            {expired ? "코드가 만료되었어요." : `남은 시간 ${formatRemaining(remainingMs)}`}
          </Text>

          <View style={{ flexDirection: "row", gap: space[3] }}>
            <Pressable
              onPress={() => handleResend("sms")}
              disabled={pending}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text
                style={{
                  color: color(expired ? "primary" : "primary"),
                  fontSize: fontSize["body-sm"],
                  fontWeight: expired ? "700" : "600",
                  opacity: pending ? 0.5 : 1,
                }}
              >
                재전송
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleResend("voice")}
              disabled={pending}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text
                style={{
                  color: color("primary"),
                  fontSize: fontSize["body-sm"],
                  fontWeight: "600",
                  opacity: pending ? 0.5 : 1,
                }}
              >
                음성 통화
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy: pending }}
          style={{
            backgroundColor: color(canSubmit ? "primary" : "border-strong"),
            paddingVertical: space[4],
            borderRadius: radius.lg,
            alignItems: "center",
            minHeight: touch.min,
            justifyContent: "center",
            opacity: canSubmit ? 1 : 0.6,
          }}
        >
          <Text style={{ color: color("on-primary"), fontSize: fontSize.body, fontWeight: "700" }}>
            {pending ? "확인 중..." : "확인"}
          </Text>
        </Pressable>
      </View>

      {/* D-01 — 로그인 코드 오류/만료 다이얼로그 */}
      <Modal
        visible={dialog !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDialog(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "#0009",
            justifyContent: "center",
            alignItems: "center",
            padding: space[6],
          }}
        >
          <View
            role="alertdialog"
            accessibilityLabel={dialog === "expired" ? "코드 만료" : "코드 오류"}
            style={{
              width: "100%",
              maxWidth: 360,
              backgroundColor: color("surface"),
              borderRadius: radius.xl,
              padding: space[6],
              gap: space[4],
            }}
          >
            <Text
              style={{
                color: color("text-primary"),
                fontSize: fontSize["title-md"],
                fontWeight: "700",
              }}
            >
              {dialog === "expired" ? "코드가 만료되었어요" : "코드가 일치하지 않아요"}
            </Text>
            <Text
              style={{
                color: color("text-secondary"),
                fontSize: fontSize.body,
                lineHeight: 22,
              }}
            >
              {dialog === "expired"
                ? "보안을 위해 코드는 일정 시간 후 만료됩니다. 새 코드를 받아 다시 시도해 주세요."
                : "입력한 인증번호를 다시 확인해 주세요. 여러 번 실패하면 잠시 후 다시 시도해야 할 수 있어요."}
            </Text>
            <View style={{ flexDirection: "row", gap: space[3], justifyContent: "flex-end" }}>
              <Pressable
                onPress={() => {
                  setDialog(null);
                  clearError();
                  setCode("");
                  inputRef.current?.focus();
                }}
                accessibilityRole="button"
                style={{
                  paddingHorizontal: space[5],
                  paddingVertical: space[3],
                  borderRadius: radius.md,
                  minHeight: touch.min,
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: color("text-secondary"), fontWeight: "600" }}>다시 시도</Text>
              </Pressable>
              <Pressable
                onPress={() => handleResend("sms")}
                accessibilityRole="button"
                style={{
                  paddingHorizontal: space[5],
                  paddingVertical: space[3],
                  borderRadius: radius.md,
                  backgroundColor: color("primary"),
                  minHeight: touch.min,
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: color("on-primary"), fontWeight: "700" }}>코드 재전송</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
