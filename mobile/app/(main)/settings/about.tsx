/**
 * S-21 · 정보 / 라이선스 (UC-01). App version + policy links.
 */
import { View, Text, Pressable, Linking } from "react-native";
import Constants from "expo-constants";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";

export default function AboutScreen() {
  const { color } = useTheme();
  const version = Constants.expoConfig?.version ?? "0.1.0";

  const Link = ({ label, url }: { label: string; url: string }) => (
    <Pressable
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      style={{ paddingVertical: space[4], minHeight: touch.min, justifyContent: "center" }}
    >
      <Text style={{ color: color("primary"), fontSize: fontSize.body }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <View style={{ padding: space[5], gap: space[4] }}>
        <View style={{ alignItems: "center", gap: space[2], marginVertical: space[6] }}>
          <Text style={{ fontSize: 48 }}>💬</Text>
          <Text style={{ color: color("text-primary"), fontSize: fontSize["title-md"], fontWeight: "700" }}>Agent Client</Text>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>버전 {version}</Text>
        </View>

        <View style={{ backgroundColor: color("surface-elevated"), borderRadius: radius.xl, paddingHorizontal: space[5] }}>
          <Link label="이용약관" url="https://example.com/terms" />
          <View style={{ height: 1, backgroundColor: color("border") }} />
          <Link label="개인정보 처리방침" url="https://example.com/privacy" />
          <View style={{ height: 1, backgroundColor: color("border") }} />
          <Link label="오픈소스 라이선스" url="https://example.com/licenses" />
        </View>

        <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, textAlign: "center", lineHeight: 18 }}>
          Telegram 호환 Bot API 기반 · 확장(GFM 마크다운 / 스트리밍 / trace) 지원
        </Text>
      </View>
    </SafeAreaView>
  );
}
