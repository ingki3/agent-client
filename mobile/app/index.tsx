/**
 * S-01 · Splash → branch. Session (user id) is read in the root layout's hydrate();
 * here we wait and route: onboarding → user-id entry, ready → friends list.
 */
import { useEffect } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { useTheme } from "@/design/theme";
import { fontSize, space } from "@/design/tokens";
import { useAuthStore } from "@/application/stores/auth";
import { useBuddiesStore } from "@/application/stores/buddies";

export default function Splash() {
  const { color } = useTheme();
  const status = useAuthStore((s) => s.status);
  const hydrateBuddies = useBuddiesStore((s) => s.hydrate);

  useEffect(() => {
    if (status === "ready") void hydrateBuddies();
  }, [status, hydrateBuddies]);

  if (status === "onboarding") return <Redirect href="/userid" />;
  if (status === "ready") return <Redirect href="/buddies" />;

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color("surface"), gap: space[4] }}>
      <Text style={{ fontSize: 56 }}>💬</Text>
      <Text style={{ color: color("text-primary"), fontSize: fontSize["title-lg"], fontWeight: "700" }}>Agent Client</Text>
      <ActivityIndicator color={color("primary")} />
    </View>
  );
}
