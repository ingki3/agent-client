import { Text, View } from 'react-native';

import { SubmitButton } from '@/ui/components/ActionButtons';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space } from '@/ui/theme/tokens';

import { HelperShell } from './primitives';
import type { ArtifactItem, SendHelperAction } from './types';

export function ArtifactHelper({
  item,
  done,
  onSend,
}: {
  item: ArtifactItem;
  done: Record<string, boolean>;
  onSend: SendHelperAction;
}) {
  const { color } = useTheme();
  const artifactTitle = item.artifact?.title ?? item.title;
  const artifactKind = item.artifact?.kind ?? 'artifact';
  return (
    <HelperShell title={item.title}>
      <View
        style={{
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color('border'),
          padding: space[3],
          gap: space[1],
        }}
      >
        <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>{artifactKind}</Text>
        <Text style={{ color: color('text-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }}>
          {artifactTitle}
        </Text>
      </View>
      <SubmitButton
        disabled={!!done[item.id]}
        label="산출물로 저장"
        onPress={() => void onSend(item.id, {
          action: 'save_artifact',
          label: '산출물로 저장',
          value: artifactTitle,
        })}
      />
    </HelperShell>
  );
}
