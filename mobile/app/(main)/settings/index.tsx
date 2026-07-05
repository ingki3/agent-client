/**
 * S-20 · 설정. User id + links; reset → D-05 → signOut → onboarding (user-id entry).
 */
import { useEffect, useState } from "react";
import { Alert, View, Text, Pressable, Modal, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useAuthStore } from "@/application/stores/auth";
import { useNotificationsStore } from "@/application/stores/notifications";
import { signOut } from "@/application/usecases/session";
import { config, defaultRelayBase, normalizeApiBase, pushEnabled, saveRelayBaseOverride } from "@/infrastructure/config";
import { relayClient } from "@/infrastructure/api/relayClient";
import { commandPermissions, type CommandPermissionStatus } from "@/infrastructure/commandPermissions";

export default function SettingsScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const phone = useAuthStore((s) => s.phoneE164);
  const tokenExpiresAt = useAuthStore((s) => s.tokenExpiresAt);
  const permission = useNotificationsStore((s) => s.permission);
  const enableNotifications = useNotificationsStore((s) => s.enable);
  const [confirm, setConfirm] = useState(false);
  const [relayBase, setRelayBase] = useState(config.relayBase ?? "");
  const [relayStatus, setRelayStatus] = useState<"idle" | "checking" | "ok" | "failed">("idle");
  const [permStatus, setPermStatus] = useState<CommandPermissionStatus | null>(null);

  useEffect(() => {
    setRelayBase(config.relayBase ?? "");
    if (commandPermissions.supported()) void commandPermissions.status().then(setPermStatus);
  }, []);

  const requestCommandPerms = async () => {
    const next = await commandPermissions.requestAll();
    setPermStatus(next);
    if (next.granted < next.total || !next.backgroundLocation) {
      Alert.alert(
        "권한 일부 미허용",
        "에이전트가 폰을 제어하려면 위치(항상 허용)·문자·연락처·미디어 권한이 필요합니다. 시스템 설정에서 직접 허용해 주세요.",
      );
    }
  };

  const permLabel = !permStatus
    ? "에이전트 폰 제어 권한"
    : permStatus.granted === permStatus.total && permStatus.backgroundLocation
      ? "에이전트 폰 제어 권한 (모두 허용됨)"
      : `에이전트 폰 제어 권한 (${permStatus.granted}/${permStatus.total}${permStatus.backgroundLocation ? " · 위치 항상" : ""})`;

  const notifLabel =
    permission === "granted" ? "알림 켜짐" : permission === "denied" ? "알림 꺼짐 (설정에서 허용)" : "알림 켜기";

  const relayLabel =
    relayStatus === "checking" ? "확인 중" : relayStatus === "ok" ? "연결됨" : relayStatus === "failed" ? "연결 실패" : "미확인";

  const saveRelay = async () => {
    const trimmed = relayBase.trim();
    if (trimmed && !normalizeApiBase(trimmed)) {
      Alert.alert("relay 주소 오류", "http:// 또는 https:// 로 시작하는 주소를 입력해 주세요.");
      return;
    }
    const saved = await saveRelayBaseOverride(trimmed || null);
    setRelayBase(saved ?? "");
    setRelayStatus("idle");
    Alert.alert("저장됨", "relay server 설정을 저장했습니다.");
  };

  const restoreRelayDefault = async () => {
    const saved = await saveRelayBaseOverride(null);
    setRelayBase(saved ?? "");
    setRelayStatus("idle");
  };

  const checkRelay = async () => {
    const trimmed = relayBase.trim();
    if (trimmed && !normalizeApiBase(trimmed)) {
      Alert.alert("relay 주소 오류", "http:// 또는 https:// 로 시작하는 주소를 입력해 주세요.");
      return;
    }
    await saveRelayBaseOverride(trimmed || null);
    setRelayStatus("checking");
    const ok = await relayClient.health();
    setRelayStatus(ok ? "ok" : "failed");
  };

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
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>로그인 계정</Text>
          <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700" }}>{phone ?? "미설정"}</Text>
          {tokenExpiresAt ? <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>Relay session active</Text> : null}
        </View>
      </View>

      <View style={{ paddingHorizontal: space[5], paddingBottom: space[5] }}>
        <View style={{ backgroundColor: color("surface-elevated"), borderRadius: radius.xl, padding: space[5], gap: space[3] }}>
          <View style={{ gap: space[1] }}>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>Relay server</Text>
            <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700" }}>{relayLabel}</Text>
            {defaultRelayBase() ? (
              <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }} numberOfLines={1}>
                기본값: {defaultRelayBase()}
              </Text>
            ) : null}
          </View>
          <TextInput
            value={relayBase}
            onChangeText={(value) => {
              setRelayBase(value);
              setRelayStatus("idle");
            }}
            placeholder="https://relay.example.com"
            placeholderTextColor={color("text-secondary")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={{
              minHeight: touch.min,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: color("border"),
              backgroundColor: color("surface"),
              color: color("text-primary"),
              fontSize: fontSize.body,
              paddingHorizontal: space[3],
            }}
          />
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Pressable
              onPress={() => void saveRelay()}
              style={{
                flex: 1,
                minHeight: touch.min,
                borderRadius: radius.md,
                backgroundColor: color("primary"),
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: color("on-primary"), fontSize: fontSize.body, fontWeight: "700" }}>저장</Text>
            </Pressable>
            <Pressable
              onPress={() => void checkRelay()}
              disabled={relayStatus === "checking"}
              style={{
                flex: 1,
                minHeight: touch.min,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: color("border"),
                alignItems: "center",
                justifyContent: "center",
                opacity: relayStatus === "checking" ? 0.6 : 1,
              }}
            >
              <Text style={{ color: color("text-primary"), fontSize: fontSize.body, fontWeight: "700" }}>연결 테스트</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => void restoreRelayDefault()} style={{ minHeight: touch.min, justifyContent: "center" }}>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>기본값으로 복원</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: color("border") }}>
        {pushEnabled() ? (
          <>
            <Row label={notifLabel} onPress={() => void enableNotifications()} />
            <View style={{ height: 1, backgroundColor: color("border"), marginLeft: space[5] }} />
          </>
        ) : null}
        {commandPermissions.supported() ? (
          <>
            <Row label={permLabel} onPress={() => void requestCommandPerms()} />
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
              텔레그램 로그아웃(릴레이 세션 해제) 후 로컬 대화 캐시가 모두 삭제됩니다.
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
