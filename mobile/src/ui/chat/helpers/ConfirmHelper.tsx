import { Text, View } from 'react-native';

import { GhostButton, SubmitButton } from '@/ui/components/ActionButtons';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, space } from '@/ui/theme/tokens';

import { HelperShell } from './primitives';
import type { ConfirmItem, SendHelperAction } from './types';

export function ConfirmHelper({
  item,
  done,
  onSend,
}: {
  item: ConfirmItem;
  done: Record<string, boolean>;
  onSend: SendHelperAction;
}) {
  const { color } = useTheme();
  const reviseLabel = item.reviseLabel;
  const cancelLabel = item.cancelLabel;
  return (
    <HelperShell title={item.title} description={item.description}>
      {item.summary?.length ? (
        <View style={{ gap: space[1] }}>
          {item.summary.map((line, index) => (
            <Text key={`${line}-${index}`} style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        {reviseLabel ? (
          <GhostButton
            label={reviseLabel}
            disabled={!!done[`${item.id}:revise`]}
            onPress={() => void onSend(`${item.id}:revise`, {
              action: 'revise',
              label: reviseLabel,
              value: reviseLabel,
            })}
          />
        ) : null}
        {cancelLabel ? (
          <GhostButton
            label={cancelLabel}
            disabled={!!done[`${item.id}:cancel`]}
            onPress={() => void onSend(`${item.id}:cancel`, {
              action: 'cancel',
              label: cancelLabel,
              value: cancelLabel,
            })}
          />
        ) : null}
        <SubmitButton
          disabled={!!done[item.id]}
          label={item.confirmLabel ?? '확인'}
          onPress={() => void onSend(item.id, {
            action: 'submit',
            label: item.confirmLabel ?? '확인',
            value: item.confirmLabel ?? '확인',
          })}
        />
      </View>
    </HelperShell>
  );
}
