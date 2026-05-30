/**
 * S-20 · 설정. User id + links; reset → D-05 → signOut → onboarding (user-id entry).
 */
import { useState } from "react";
import { View, Text, Pressable, Modal } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useAuthStore } from "@/application/stores/auth";
import { useNotificationsStore } from "@/application/stores/notifications";
import { signOut } from "@/application/usecases/session";
import { pushEnabled } from "@/infrastructure/config";

export default function SettingsScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const permission = useNotificationsStore((s) => s.permission);
  const enableNotifications = useNotificationsStore((s) => s.enable);
  const [confirm, setConfirm] = useState(false);

  const notifLabel =
    permission === "granted" ? "알림 켜짐" : permission === "denied" ? "알림 꺼짐 (설정에서 허용)" : "알림 켜기";

  const Row = ({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: space[5],
        paddingVertical: space[4],
        minHeight: touch.min,
        justifyContent: "center",
        backgroundColor: pressed ? color("surface-elevated") : color("surface"),
      })}
    >
      <Text style={{ color: danger ? color("error") : color("text-primary"), fontSize: fontSize.body }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <View style={{ padding: space[5] }}>
        <View style={{ backgroundColor: color("surface-elevated"), borderRadius: radius.xl, padding: space[5], gap: space[1] }}>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>사용자 ID</Text>
          <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700" }}>{userId ?? "미설정"}</Text>
        </View>
      </View>

      <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: color("border") }}>
        {pushEnabled ? (
          <>
            <Row label={notifLabel} onPress={() => void enableNotifications()} />
            <View style={{ height: 1, backgroundColor: color("border"), marginLeft: space[5] }} />
          </>
        ) : null}
        <Row label="정보 / 라이선스" onPress={() => router.push("/settings/about")} />
        <View style={{ height: 1, backgroundColor: color("border"), marginLeft: space[5] }} />
        <Row label="초기화 (로그아웃)" danger onPress={() => setConfirm(true)} />
      </View>

      {/* D-05 · 초기화 확인 */}
      <Modal visible={confirm} transparent animationType="fade" onRequestClose={() => setConfirm(false)}>
        <View style={{ flex: 1, backgroundColor: "#00000088", alignItems: "center", justifyContent: "center", padding: space[6] }}>
          <View style={{ backgroundColor: color("surface"), borderRadius: radius.xl, padding: space[5], gap: space[4], width: "100%", maxWidth: 360 }}>
            <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700" }}>초기화할까요?</Text>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>
              사용자 ID, 봇 토큰, 로컬 대화 캐시가 모두 삭제됩니다.
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[4] }}>
              <Pressable onPress={() => setConfirm(false)} style={{ minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[3] }}>
                <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>취소</Text>
              </Pressable>
              <Pressable
                testID="logoutConfirm"
                onPress={async () => {
                  setConfirm(false);
                  await signOut();
                  router.replace("/");
                }}
                style={{ minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[3] }}
              >
                <Text style={{ color: color("error"), fontSize: fontSize.body, fontWeight: "700" }}>초기화</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
