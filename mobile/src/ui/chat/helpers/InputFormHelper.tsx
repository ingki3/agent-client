import { useState } from 'react';
import { View } from 'react-native';

import type { FormValue } from '@/domain/entities/Message';
import { GhostButton, SubmitButton } from '@/ui/components/ActionButtons';
import { space } from '@/ui/theme/tokens';

import { initialFieldValue, present, summarizeValues } from './context';
import { HelperFieldInput, HelperShell } from './primitives';
import type { InputFormItem, SendHelperAction } from './types';

export function InputFormHelper({
  item,
  done,
  onSend,
}: {
  item: InputFormItem;
  done: Record<string, boolean>;
  onSend: SendHelperAction;
}) {
  const [values, setValues] = useState<Record<string, FormValue>>(() => {
    const initial: Record<string, FormValue> = {};
    for (const field of item.fields) initial[field.id] = initialFieldValue(field);
    return initial;
  });
  const complete = item.fields.every((field) => !field.required || present(values[field.id]));
  const disabled = !!done[item.id] || !complete;
  const cancelLabel = item.cancelLabel;

  const update = (id: string, value: FormValue) => {
    setValues((prev) => ({ ...prev, [id]: value }));
  };

  return (
    <HelperShell title={item.title} description={item.description}>
      <View style={{ gap: space[3] }}>
        {item.fields.map((field) => (
          <HelperFieldInput
            key={field.id}
            field={field}
            value={values[field.id]}
            onChange={(value) => update(field.id, value)}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        {cancelLabel ? (
          <GhostButton
            label={cancelLabel}
            disabled={!!done[`${item.id}:cancel`]}
            onPress={() => void onSend(`${item.id}:cancel`, {
              action: 'cancel',
              label: cancelLabel,
              value: cancelLabel,
              values,
            })}
          />
        ) : null}
        <SubmitButton
          disabled={disabled}
          label={item.submitLabel ?? '전송'}
          onPress={() => void onSend(item.id, {
            action: 'submit',
            label: item.submitLabel ?? '전송',
            value: summarizeValues(values),
            values,
          })}
        />
      </View>
    </HelperShell>
  );
}
