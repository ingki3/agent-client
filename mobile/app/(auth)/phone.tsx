/**
 * S-02 · 전화번호 입력 (TECH §3.5)
 * pen frame: TBD — design system tokens via @/ui/theme/*.
 *
 * Flow: 국가 코드 dropdown → national input → 약관 체크 → [다음] → sendCode → /(auth)/otp.
 */
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { fontSize, radius, space, touch } from "@/ui/theme/tokens";
import { useAuthStore } from "@/application/stores/auth";
import {
  COUNTRIES,
  type CountryEntry,
  normalizeToE164,
} from "@/domain/value-objects/phone";

function defaultCountry(): CountryEntry {
  // TODO(BIZ-262): infer from device locale once libphonenumber-js lands.
  return COUNTRIES.find((c) => c.code === "KR") ?? COUNTRIES[0]!;
}

function localizedError(reason: ReturnType<typeof normalizeToE164> extends infer R
  ? R extends { ok: false; reason: infer K }
    ? K
    : never
  : never): string {
  switch (reason) {
    case "empty":
      return "전화번호를 입력해 주세요.";
    case "too_short":
      return "번호가 너무 짧아요.";
    case "too_long":
      return "번호가 너무 길어요.";
    case "invalid_format":
    default:
      return "전화번호 형식을 확인해 주세요.";
  }
}

export default function PhoneScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const sendCode = useAuthStore((s) => s.sendCode);
  const pending = useAuthStore((s) => s.pending);
  const apiError = useAuthStore((s) => s.lastError);
  const clearError = useAuthStore((s) => s.clearError);

  const [country, setCountry] = useState<CountryEntry>(() => defaultCountry());
  const [national, setNational] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [picker, setPicker] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const normalized = useMemo(
    () => normalizeToE164(national, country.dialCode, country.trunkPrefix),
    [national, country],
  );
  const canSubmit = normalized.ok && agreed && !pending;

  const handleNext = async () => {
    setInlineError(null);
    clearError();
    if (!normalized.ok) {
      setInlineError(localizedError(normalized.reason));
      return;
    }
    if (!agreed) {
      setInlineError("약관에 동의해야 진행할 수 있어요.");
      return;
    }
    const ok = await sendCode(normalized.e164);
    if (ok) router.push("/(auth)/otp");
  };

  const apiMessage =
    apiError?.code === "rate_limited"
      ? "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."
      : apiError?.code === "invalid_phone"
        ? "이 번호로는 인증번호를 보낼 수 없어요."
        : apiError?.code === "network"
          ? "네트워크 연결을 확인해 주세요."
          : apiError
            ? "잠시 후 다시 시도해 주세요."
            : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: space[6],
          gap: space[5],
          justifyContent: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space[2] }}>
          <Text
            style={{
              color: color("text-primary"),
              fontSize: fontSize["title-xl"],
              fontWeight: "700",
            }}
          >
            전화번호로 시작하기
          </Text>
          <Text
            style={{
              color: color("text-secondary"),
              fontSize: fontSize.body,
              lineHeight: 22,
            }}
          >
            인증번호를 SMS로 보내드려요. 한 번 가입하면 같은 번호로 자동 로그인됩니다.
          </Text>
        </View>

        <View style={{ gap: space[2] }}>
          <Text
            style={{
              color: color("text-secondary"),
              fontSize: fontSize["body-sm"],
              fontWeight: "600",
            }}
            accessibilityRole="text"
          >
            전화번호
          </Text>
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="국가 코드 선택"
              onPress={() => setPicker(true)}
              style={{
                paddingHorizontal: space[3],
                paddingVertical: space[3],
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: color("border-strong"),
                minWidth: 90,
                minHeight: touch.min,
                justifyContent: "center",
              }}
            >
              <Text style={{ color: color("text-primary"), fontWeight: "600" }}>
                {country.dialCode}
              </Text>
              <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>
                {country.code}
              </Text>
            </Pressable>

            <TextInput
              value={national}
              onChangeText={(t) => {
                setInlineError(null);
                clearError();
                setNational(t);
              }}
              placeholder={country.exampleNational}
              placeholderTextColor={color("text-secondary")}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              importantForAutofill="yes"
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: color(inlineError ? "error" : "border-strong"),
                borderRadius: radius.md,
                paddingHorizontal: space[4],
                paddingVertical: space[3],
                color: color("text-primary"),
                fontSize: fontSize.body,
                minHeight: touch.min,
              }}
            />
          </View>

          {(inlineError || apiMessage) && (
            <Text
              role="alert"
              style={{ color: color("error"), fontSize: fontSize["body-sm"] }}
            >
              {inlineError ?? apiMessage}
            </Text>
          )}
        </View>

        <Pressable
          onPress={() => setAgreed((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: space[3],
            paddingVertical: space[2],
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: radius.sm,
              borderWidth: 1.5,
              borderColor: color(agreed ? "primary" : "border-strong"),
              backgroundColor: color(agreed ? "primary" : "surface"),
              alignItems: "center",
              justifyContent: "center",
              marginTop: 2,
            }}
          >
            {agreed && (
              <Text style={{ color: color("on-primary"), fontWeight: "700", fontSize: 14 }}>
                ✓
              </Text>
            )}
          </View>
          <Text
            style={{
              flex: 1,
              color: color("text-primary"),
              fontSize: fontSize["body-sm"],
              lineHeight: 20,
            }}
          >
            서비스 이용약관 · 개인정보 처리방침에 동의합니다.
          </Text>
        </Pressable>

        <Pressable
          onPress={handleNext}
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
          <Text
            style={{
              color: color("on-primary"),
              fontSize: fontSize.body,
              fontWeight: "700",
            }}
          >
            {pending ? "전송 중..." : "다음"}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={picker}
        animationType="slide"
        transparent
        onRequestClose={() => setPicker(false)}
      >
        <Pressable
          onPress={() => setPicker(false)}
          style={{ flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: color("surface"),
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingTop: space[4],
              paddingBottom: space[6],
              maxHeight: "75%",
            }}
          >
            <Text
              style={{
                color: color("text-primary"),
                fontSize: fontSize["title-md"],
                fontWeight: "700",
                paddingHorizontal: space[5],
                paddingBottom: space[3],
              }}
            >
              국가 선택
            </Text>
            <ScrollView>
              {COUNTRIES.map((c) => {
                const selected = c.code === country.code;
                return (
                  <Pressable
                    key={c.code}
                    onPress={() => {
                      setCountry(c);
                      setPicker(false);
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: space[5],
                      paddingVertical: space[4],
                      gap: space[3],
                      backgroundColor: color(selected ? "surface-elevated" : "surface"),
                      minHeight: touch.min,
                    }}
                  >
                    <Text style={{ color: color("text-primary"), flex: 1, fontSize: fontSize.body }}>
                      {c.label}
                    </Text>
                    <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>
                      {c.dialCode}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
