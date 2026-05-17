/**
 * S-21 · 버디(채널) 목록
 * pen frame: JCqD4 (Light) / svfdd (Dark)
 */
import { View, FlatList, Pressable, Text } from "react-native";
import { useRouter, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, space } from "@/design/tokens";
import { useBuddiesStore } from "@/store/buddies";
import { BuddyRow } from "@/components/BuddyRow";

export default function BuddyListScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const buddies = useBuddiesStore((s) => s.buddies);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: "버디 목록",
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/add-buddy")}
              accessibilityLabel="버디 추가"
              hitSlop={8}
              style={{ paddingHorizontal: space[2] }}
            >
              <Text style={{ color: color("primary"), fontSize: 22, fontWeight: "300" }}>+</Text>
            </Pressable>
          ),
        }}
      />

      <View
        style={{
          paddingHorizontal: space[4],
          paddingTop: space[2],
          paddingBottom: space[2],
        }}
      >
        <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>
          에이전트를 선택해 대화를 시작하세요.
        </Text>
      </View>

      <FlatList
        data={buddies}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => (
          <BuddyRow
            buddy={item}
            variant="list"
            onPress={() => router.push(`/chat/${item.id}`)}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: color("border"), marginLeft: 76 }} />
        )}
      />
    </SafeAreaView>
  );
}
