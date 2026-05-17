/**
 * M-01 · 버디 추가 진입 (BottomSheet — modal in Expo Router)
 * pen frame: N3X6FI (Light) / inuhZ (Dark)
 *
 * Mock-only: token validation / getMe / QR are stubbed for usability testing.
 */
import { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useBuddiesStore } from "@/store/buddies";
import type { AccentSlot, Buddy } from "@/mock/fixtures";

const ROLE_OPTIONS: Array<{ key: Buddy["role"]; label: string; accent: AccentSlot }> = [
  { key: "work", label: "업무", accent: "accent-buddy-1" },
  { key: "personal", label: "개인", accent: "accent-buddy-2" },
  { key: "research", label: "리서치", accent: "accent-buddy-6" },
];

export default function AddBuddyScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const addBuddy = useBuddiesStore((s) => s.addBuddy);

  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [role, setRole] = useState<Buddy["role"]>("personal");

  const canSubmit = displayName.trim().length > 0 && token.trim().length > 0;

  const handleAdd = () => {
    if (!canSubmit) return;
    const accent = ROLE_OPTIONS.find((r) => r.key === role)?.accent ?? "accent-buddy-1";
    const id = addBuddy({
      displayName: displayName.trim(),
      handle: `@${token.split(":")[0]?.slice(0, 12) || "new_bot"}`,
      accent,
      role,
      description: "Mock 환경에서 추가된 버디 (BIZ-230)",
    });
    router.replace(`/chat/${id}`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }}>
      <Stack.Screen
        options={{
          title: "버디 추가",
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8} style={{ paddingHorizontal: space[2] }}>
              <Text style={{ color: color("primary"), fontSize: fontSize.body }}>닫기</Text>
            </Pressable>
          ),
        }}
      />

      <View style={{ flex: 1, padding: space[5], gap: space[5] }}>
        <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"], lineHeight: 20 }}>
          텔레그램 봇 토큰을 입력하거나 딥링크/QR로 새 에이전트를 추가하세요. 현재 빌드는 mock —
          [추가]를 누르면 가상 버디가 즉시 생성됩니다.
        </Text>

        <Field label="표시 이름">
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="예: Work Buddy"
            placeholderTextColor={color("text-secondary")}
            style={inputStyle(color)}
            autoCapitalize="words"
          />
        </Field>

        <Field label="봇 토큰">
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="123456789:ABC-DEF..."
            placeholderTextColor={color("text-secondary")}
            style={inputStyle(color)}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>

        <Field label="역할">
          <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
            {ROLE_OPTIONS.map((opt) => {
              const selected = role === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setRole(opt.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space[2],
                    paddingHorizontal: space[4],
                    paddingVertical: space[2],
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: selected ? color("primary") : color("border"),
                    backgroundColor: selected ? color("trace-summary") : color("surface"),
                  }}
                >
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: radius.full,
                      backgroundColor: color(opt.accent),
                    }}
                  />
                  <Text
                    style={{
                      color: color(selected ? "on-trace-summary" : "text-primary"),
                      fontSize: fontSize["body-sm"],
                      fontWeight: selected ? "600" : "400",
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={handleAdd}
          disabled={!canSubmit}
          accessibilityRole="button"
          style={{
            backgroundColor: color(canSubmit ? "primary" : "surface-elevated"),
            borderRadius: radius.full,
            paddingVertical: space[3],
            alignItems: "center",
            minHeight: touch.min,
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: color(canSubmit ? "on-primary" : "text-disabled"),
              fontSize: fontSize.body,
              fontWeight: "700",
            }}
          >
            추가
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { color } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>
        {label.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function inputStyle(color: (t: Parameters<ReturnType<typeof useTheme>["color"]>[0]) => string) {
  return {
    backgroundColor: color("surface-elevated"),
    color: color("text-primary"),
    fontSize: fontSize.body,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.lg,
    minHeight: touch.min,
  } as const;
}
