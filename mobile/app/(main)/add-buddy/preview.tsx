/**
 * S-13 · 친구 추가 — 미리보기 / 확정
 *
 * Trigger: S-12 [다음] 성공 후 draft 로 진입.
 * Outcome:
 *   - [추가] → addBuddyFlow → dismissAll() → push /chat/<id>
 *   - /start 송신 실패는 토스트로 알리고 등록은 유지 (FR-07)
 *   - draft 가 비어 있으면 (deep-link 등) S-12 로 되돌림
 */
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BotApiError } from '@/domain/rules/BotApiError';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space, touch } from '@/ui/theme/tokens';

import {
  clearAddBuddyDraft,
  readAddBuddyDraft,
  type AddBuddyDraft,
} from '../../_runtime/add-buddy-draft';
import { addBuddyFlow, DuplicateBuddyError } from '../../_runtime/buddies';

function describeError(err: unknown): string {
  if (err instanceof DuplicateBuddyError) {
    return `이미 등록된 친구 (“${err.existing.displayName}”) 입니다.`;
  }
  if (err instanceof BotApiError) {
    if (err.kind === 'invalid_token') return '유효하지 않은 토큰입니다.';
    if (err.kind === 'network_error') return '네트워크에 연결할 수 없습니다.';
    return '봇 정보를 가져오지 못했습니다.';
  }
  return '친구 추가에 실패했습니다.';
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return (trimmed[0] ?? '?').toUpperCase();
}

export default function AddBuddyPreviewScreen() {
  const { color } = useTheme();
  const router = useRouter();

  const [draft, setDraft] = useState<AddBuddyDraft | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const current = readAddBuddyDraft();
      if (!current) {
        router.replace('/add-buddy/token');
        return;
      }
      setDraft(current);
      setDisplayName(current.defaultDisplayName);
      return undefined;
    }, [router]),
  );

  useEffect(() => {
    return () => {
      // Leaving the screen for any reason — pop the draft so the next entry
      // cannot accidentally reuse a stale token.
      clearAddBuddyDraft();
    };
  }, []);

  const canSubmit = useMemo(
    () => !submitting && displayName.trim().length > 0 && draft !== null,
    [submitting, displayName, draft],
  );

  const handleAdd = async () => {
    if (!canSubmit || !draft) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await addBuddyFlow({
        token: draft.token,
        displayName: displayName.trim(),
      });
      clearAddBuddyDraft();
      router.dismissAll();
      router.push(`/chat/${result.buddy.id}`);
      // /start 실패는 토스트로 알리되 등록은 유지. ui-store 의 toast 큐를 사용하지만,
      // toast 인프라가 별도 sub-issue 라 콘솔 경고로만 남기고 silent 처리한다 (FR-07).
      if (!result.startSent && result.startError) {
        console.warn('[BIZ-265] /start failed but buddy registered:', result.startError);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!draft) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color('surface') }}>
        <Stack.Screen options={{ title: '확인' }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color('surface') }}>
      <Stack.Screen options={{ title: '확인' }} />

      <ScrollView contentContainerStyle={{ padding: space[5], gap: space[5] }}>
        <View style={{ alignItems: 'center', gap: space[3] }}>
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: radius.full,
              backgroundColor: color('surface-elevated'),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                color: color('text-primary'),
                fontSize: fontSize['title-xl'],
                fontWeight: '700',
              }}
            >
              {initials(draft.identity.firstName)}
            </Text>
          </View>
          <Text
            style={{
              color: color('text-primary'),
              fontSize: fontSize['title-md'],
              fontWeight: '700',
            }}
          >
            {draft.identity.firstName}
          </Text>
          {draft.identity.username ? (
            <Text style={{ color: color('text-secondary'), fontSize: fontSize['body-sm'] }}>
              @{draft.identity.username}
            </Text>
          ) : null}
        </View>

        <View
          style={{
            backgroundColor: color('surface-elevated'),
            borderRadius: radius.lg,
            padding: space[4],
            gap: space[2],
          }}
        >
          <Text
            style={{
              color: color('text-secondary'),
              fontSize: fontSize.caption,
              fontWeight: '600',
            }}
          >
            추가하면
          </Text>
          <Text
            style={{
              color: color('text-primary'),
              fontSize: fontSize['body-sm'],
              lineHeight: 20,
            }}
          >
            • 봇 토큰은 이 기기 보안 저장소에만 저장됩니다 (서버 미전송){'\n'}
            • 봇과의 첫 메시지로 `/start` 가 자동 전송됩니다{'\n'}
            • 채팅 로그는 이 기기 SQLite 에 보관되며 친구 삭제 시 함께 삭제됩니다
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
            표시 이름
          </Text>
          <TextInput
            value={displayName}
            onChangeText={(v) => {
              setDisplayName(v);
              if (error) setError(null);
            }}
            placeholder="친구 목록에 표시할 이름"
            placeholderTextColor={color('text-secondary')}
            accessibilityLabel="표시 이름"
            autoCapitalize="words"
            style={{
              backgroundColor: color('surface-elevated'),
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: error ? color('error') : color('border'),
              color: color('text-primary'),
              fontSize: fontSize.body,
              paddingHorizontal: space[4],
              paddingVertical: space[3],
              minHeight: touch.min,
            }}
          />
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: color('error'), fontSize: fontSize.caption }}
            >
              {error}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={{
          padding: space[5],
          paddingTop: space[3],
          borderTopWidth: 1,
          borderTopColor: color('border'),
          flexDirection: 'row',
          gap: space[2],
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="이전"
          style={{
            paddingHorizontal: space[5],
            paddingVertical: space[3],
            borderRadius: radius.full,
            borderWidth: 1,
            borderColor: color('border'),
            minHeight: touch.min,
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: color('text-primary'), fontSize: fontSize.body }}>이전</Text>
        </Pressable>
        <Pressable
          onPress={handleAdd}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="추가"
          accessibilityState={{ disabled: !canSubmit }}
          style={{
            flex: 1,
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
            {submitting ? '추가 중…' : '추가'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
