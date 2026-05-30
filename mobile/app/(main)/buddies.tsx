/**
 * S-10 · 친구 리스트 (Home, UC-03). FAB → add-buddy, header → settings, long-press →
 * M-02 quick actions → D-04 delete confirm. S-10-EMPTY variant when no buddies.
 */
import { useState } from "react";
import { View, Text, FlatList, Pressable, Modal } from "react-native";
import { useRouter, Stack, Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useAuthStore } from "@/application/stores/auth";
import { useBuddiesStore } from "@/application/stores/buddies";
import { BuddyRow } from "@/components/BuddyRow";
import { Avatar } from "@/components/Avatar";
import type { Buddy } from "@/domain/entities";

export default function BuddiesScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const buddies = useBuddiesStore((s) => s.buddies);
  const removeBuddy = useBuddiesStore((s) => s.remove);

  const [sheetFor, setSheetFor] = useState<Buddy | null>(null);
  const [confirmFor, setConfirmFor] = useState<Buddy | null>(null);

  if (status === "guest") return <Redirect href="/phone" />;

  const SettingsButton = (
    <Pressable
      testID="settingsButton"
      onPress={() => router.push("/settings")}
      accessibilityLabel="설정 열기"
      hitSlop={8}
      style={{ paddingHorizontal: space[2], minHeight: touch.min, justifyContent: "center" }}
    >
      <Text style={{ fontSize: fontSize["title-md"] }}>⚙️</Text>
    </Pressable>
  );

  if (buddies.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
        <Stack.Screen options={{ title: "친구", headerRight: () => SettingsButton }} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space[6], gap: space[4] }}>
          <Text style={{ fontSize: 56 }}>📭</Text>
          <Text style={{ color: color("text-primary"), fontSize: fontSize["title-lg"], fontWeight: "700", textAlign: "center" }}>
            아직 등록된 친구가 없어요
          </Text>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.body, textAlign: "center" }}>
            봇 토큰으로 에이전트를 추가해 대화를 시작해 보세요.
          </Text>
          <Pressable
            onPress={() => router.push("/add-buddy/token")}
            style={{
              backgroundColor: color("primary"),
              paddingHorizontal: space[6],
              paddingVertical: space[3],
              borderRadius: radius.full,
              minHeight: touch.min,
              justifyContent: "center",
              marginTop: space[4],
            }}
          >
            <Text style={{ color: color("on-primary"), fontWeight: "700", fontSize: fontSize.body }}>+ 친구 추가</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <Stack.Screen options={{ title: "친구", headerRight: () => SettingsButton }} />

      <FlatList
        data={buddies}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => (
          <BuddyRow
            buddy={item}
            onPress={() => router.push(`/chat/${item.id}`)}
            onLongPress={() => setSheetFor(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: color("border"), marginLeft: 76 }} />}
        contentContainerStyle={{ paddingBottom: 96 }}
      />

      <Pressable
        testID="fabAddBuddy"
        onPress={() => router.push("/add-buddy/token")}
        accessibilityLabel="친구 추가"
        accessibilityRole="button"
        style={{
          position: "absolute",
          right: space[5],
          bottom: space[6],
          width: 56,
          height: 56,
          borderRadius: radius.full,
          backgroundColor: color("primary"),
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Text style={{ color: color("on-primary"), fontSize: 28, fontWeight: "300", marginTop: -2 }}>+</Text>
      </Pressable>

      {/* M-02 · 친구 빠른 액션 */}
      <Modal visible={sheetFor !== null} transparent animationType="fade" onRequestClose={() => setSheetFor(null)}>
        <Pressable accessible={false} onPress={() => setSheetFor(null)} style={{ flex: 1, backgroundColor: "#00000088", justifyContent: "flex-end" }}>
          <Pressable
            accessible={false}
            onPress={() => undefined}
            style={{ backgroundColor: color("surface"), borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], padding: space[5], gap: space[4] }}
          >
            {sheetFor ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
                <Avatar name={sheetFor.displayName} accent={sheetFor.accent} size={44} />
                <View>
                  <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700" }}>{sheetFor.displayName}</Text>
                  <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>{sheetFor.handle}</Text>
                </View>
              </View>
            ) : null}
            <Pressable
              testID="sheetDelete"
              onPress={() => {
                setConfirmFor(sheetFor);
                setSheetFor(null);
              }}
              style={{ paddingVertical: space[3], minHeight: touch.min, justifyContent: "center" }}
            >
              <Text style={{ color: color("error"), fontSize: fontSize.body, fontWeight: "600" }}>삭제</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* D-04 · 친구 삭제 확인 */}
      <Modal visible={confirmFor !== null} transparent animationType="fade" onRequestClose={() => setConfirmFor(null)}>
        <View style={{ flex: 1, backgroundColor: "#00000088", alignItems: "center", justifyContent: "center", padding: space[6] }}>
          <View style={{ backgroundColor: color("surface"), borderRadius: radius.xl, padding: space[5], gap: space[4], width: "100%", maxWidth: 360 }}>
            <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700" }}>친구를 삭제할까요?</Text>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>대화 로그와 봇 토큰이 함께 삭제됩니다. 되돌릴 수 없어요.</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[4], marginTop: space[2] }}>
              <Pressable onPress={() => setConfirmFor(null)} style={{ minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[3] }}>
                <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>취소</Text>
              </Pressable>
              <Pressable
                testID="deleteConfirm"
                onPress={() => {
                  if (confirmFor) void removeBuddy(confirmFor.id);
                  setConfirmFor(null);
                }}
                style={{ minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[3] }}
              >
                <Text style={{ color: color("error"), fontSize: fontSize.body, fontWeight: "700" }}>삭제</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
