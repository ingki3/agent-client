/**
 * S-12 · 봇 토큰 입력
 *
 * Trigger: S-10 FAB[+] or S-10-EMPTY CTA.
 * Outcome:
 *   - getMe 성공 + 신규 봇        → push /add-buddy/preview (S-13)
 *   - getMe 실패 (invalid/network) → 인라인 에러 ("유효하지 않은 토큰입니다")
 *   - getMe 성공 + 이미 등록된 봇 → D-03 다이얼로그
 */
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BotApiError } from '@/domain/rules/BotApiError';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space, touch } from '@/ui/theme/tokens';
import { describeBotApiError } from '@/ui/utils/describeBotApiError';

import { setAddBuddyDraft } from '../../_runtime/add-buddy-draft';
import { previewBuddyFromToken } from '../../_runtime/buddies';

function describeError(err: unknown): string {
  if (err instanceof BotApiError) {
    return describeBotApiError(err)
      ?? (err.kind === 'rate_limited' ? '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
        : err.kind === 'aborted' ? '요청이 취소되었습니다.'
        : '토큰 확인에 실패했습니다.');
  }
  return '알 수 없는 오류가 발생했습니다.';
}

export default function AddBuddyTokenScreen() {
  const { color } = useTheme();
  const router = useRouter();

  const [token, setToken] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{
    displayName: string;
    buddyId: string;
  } | null>(null);

  const trimmed = token.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleNext = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { identity, duplicateOf } = await previewBuddyFromToken(trimmed);
      if (duplicateOf) {
        setDuplicate({ displayName: duplicateOf.displayName, buddyId: duplicateOf.id });
        return;
      }
      setAddBuddyDraft({
        token: trimmed,
        identity,
        defaultDisplayName: identity.username || identity.firstName,
      });
      router.push('/add-buddy/preview');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color('surface') }}>
      <Stack.Screen
        options={{
          title: '친구 추가',
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="닫기"
              style={{ paddingHorizontal: space[2] }}
            >
              <Text style={{ color: color('primary'), fontSize: fontSize.body }}>닫기</Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView
        contentContainerStyle={{ padding: space[5], gap: space[5] }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space[2] }}>
          <Text
            style={{
              color: color('text-primary'),
              fontSize: fontSize['title-md'],
              fontWeight: '700',
            }}
          >
            봇 토큰을 입력해 주세요
          </Text>
          <Text
            style={{
              color: color('text-secondary'),
              fontSize: fontSize['body-sm'],
              lineHeight: 20,
            }}
          >
            텔레그램 BotFather 에서 받은 토큰을 입력하면, 해당 봇과의 대화 채널이 추가됩니다.
            토큰은 이 기기에만 안전하게 저장됩니다.
          </Text>
        </View>

        <View style={{ gap: space[2] }}>
          <Text
            style={{
              color: color('text-secondary'),
              fontSize: fontSize.caption,
              fontWeight: '600',
            }}
          >
            BOT 토큰
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: color('surface-elevated'),
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: error ? color('error') : color('border'),
            }}
          >
            <TextInput
              value={token}
              onChangeText={(v) => {
                setToken(v);
                if (error) setError(null);
              }}
              placeholder="123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              placeholderTextColor={color('text-secondary')}
              secureTextEntry={!revealed}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              accessibilityLabel="봇 토큰"
              style={{
                flex: 1,
                color: color('text-primary'),
                fontSize: fontSize.body,
                paddingHorizontal: space[4],
                paddingVertical: space[3],
                minHeight: touch.min,
              }}
            />
            <Pressable
              onPress={() => setRevealed((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={revealed ? '토큰 숨기기' : '토큰 보기'}
              accessibilityState={{ checked: revealed }}
              hitSlop={8}
              style={{ paddingHorizontal: space[4], paddingVertical: space[2] }}
            >
              <Text style={{ color: color('primary'), fontSize: fontSize['body-sm'] }}>
                {revealed ? '숨기기' : '보기'}
              </Text>
            </Pressable>
          </View>
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: color('error'), fontSize: fontSize.caption }}
            >
              {error}
            </Text>
          ) : (
            <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
              입력란을 길게 눌러 클립보드에서 붙여넣을 수 있어요.
            </Text>
          )}
        </View>

        <View style={{ gap: space[1] }}>
          <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
            토큰은 어디서 받나요?
          </Text>
          <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption, lineHeight: 18 }}>
            텔레그램에서 @BotFather 에게 `/newbot` 명령을 보내면 새 봇과 함께 토큰을 받을 수 있어요.
          </Text>
        </View>
      </ScrollView>

      <View
        style={{
          padding: space[5],
          paddingTop: space[3],
          backgroundColor: color('surface'),
          borderTopWidth: 1,
          borderTopColor: color('border'),
        }}
      >
        <Pressable
          onPress={handleNext}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
          style={{
            backgroundColor: color(canSubmit ? 'primary' : 'surface-elevated'),
            borderRadius: radius.full,
            paddingVertical: space[3],
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: touch.min,
          }}
        >
          <Text
            style={{
              color: color(canSubmit ? 'on-primary' : 'text-disabled'),
              fontSize: fontSize.body,
              fontWeight: '700',
            }}
          >
            {submitting ? '확인 중…' : '다음'}
          </Text>
        </Pressable>
      </View>

      <DuplicateDialog
        duplicate={duplicate}
        onDismiss={() => setDuplicate(null)}
        onOpenExisting={(id) => {
          setDuplicate(null);
          router.dismissAll();
          router.push(`/chat/${id}`);
        }}
      />
    </SafeAreaView>
  );
}

function DuplicateDialog({
  duplicate,
  onDismiss,
  onOpenExisting,
}: {
  duplicate: { displayName: string; buddyId: string } | null;
  onDismiss: () => void;
  onOpenExisting: (id: string) => void;
}) {
  const { color } = useTheme();
  return (
    <Modal
      visible={duplicate !== null}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: space[5],
        }}
      >
        <View
          accessibilityRole="alert"
          style={{
            width: '100%',
            maxWidth: 420,
            backgroundColor: color('surface'),
            borderRadius: radius.lg,
            padding: space[5],
            gap: space[4],
          }}
        >
          <Text
            style={{
              color: color('text-primary'),
              fontSize: fontSize['title-sm'],
              fontWeight: '700',
            }}
          >
            이미 등록된 친구예요
          </Text>
          <Text
            style={{
              color: color('text-secondary'),
              fontSize: fontSize['body-sm'],
              lineHeight: 20,
            }}
          >
            {duplicate
              ? `“${duplicate.displayName}” 라는 이름으로 이미 추가되어 있어요. 기존 친구를 여시겠어요?`
              : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: space[2], justifyContent: 'flex-end' }}>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="취소"
              style={{
                paddingHorizontal: space[4],
                paddingVertical: space[2],
                minHeight: touch.min,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: color('text-secondary'), fontSize: fontSize.body }}>취소</Text>
            </Pressable>
            <Pressable
              onPress={() => duplicate && onOpenExisting(duplicate.buddyId)}
              accessibilityRole="button"
              accessibilityLabel="기존 친구 열기"
              style={{
                paddingHorizontal: space[4],
                paddingVertical: space[2],
                backgroundColor: color('primary'),
                borderRadius: radius.full,
                minHeight: touch.min,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: color('on-primary'), fontSize: fontSize.body, fontWeight: '700' }}>
                기존 친구 열기
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
