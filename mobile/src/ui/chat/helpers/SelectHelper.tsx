import { useState } from 'react';
import { View } from 'react-native';

import { SubmitButton } from '@/ui/components/ActionButtons';
import { space } from '@/ui/theme/tokens';

import { HelperShell, OptionRow } from './primitives';
import type { ChoiceItem, SendHelperAction } from './types';

export function SelectHelper({
  item,
  done,
  onSend,
}: {
  item: ChoiceItem;
  done: Record<string, boolean>;
  onSend: SendHelperAction;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const disabled = !!done[item.id] || selected.length === 0;
  const single = item.type === 'single_select';

  const toggle = (value: string) => {
    setSelected((prev) => {
      if (single) return prev.includes(value) ? [] : [value];
      return prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
    });
  };

  return (
    <HelperShell title={item.title} description={item.description}>
      <View style={{ gap: space[2] }}>
        {item.options.map((opt) => {
          const checked = selected.includes(opt.value);
          return (
            <OptionRow
              key={opt.value}
              label={opt.label}
              checked={checked}
              multi={!single}
              onPress={() => toggle(opt.value)}
            />
          );
        })}
      </View>
      <SubmitButton
        disabled={disabled}
        label={item.submitLabel ?? '전송'}
        onPress={() => void onSend(item.id, {
          action: 'submit',
          label: selected
            .map((value) => item.options.find((opt) => opt.value === value)?.label ?? value)
            .join(', '),
          value: selected.join(', '),
          values: { selection: single ? selected[0] ?? null : selected },
        })}
      />
    </HelperShell>
  );
}
