/**
 * Small shared UI primitives for helper cards: the card shell, quick-reply chip,
 * single/multi option row, and the per-field input renderer.
 */
import type { ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import type { FormValue, HelperField } from '@/domain/entities/Message';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space } from '@/ui/theme/tokens';

export function HelperShell({
  title,
  description,
  children,
}: {
  title?: string | undefined;
  description?: string | undefined;
  children: ReactNode;
}) {
  const { color } = useTheme();
  return (
    <View
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color('border'),
        backgroundColor: color('surface-elevated'),
        padding: space[3],
        gap: space[3],
      }}
    >
      {title || description ? (
        <View style={{ gap: space[1] }}>
          {title ? (
            <Text style={{ color: color('text-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }}>
              {title}
            </Text>
          ) : null}
          {description ? (
            <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
              {description}
            </Text>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function HelperChip({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: color(disabled ? 'border' : 'trace-summary'),
        borderRadius: radius.full,
        paddingHorizontal: space[3],
        paddingVertical: space[2],
        minHeight: 36,
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: color(disabled ? 'text-disabled' : 'on-trace-summary'),
          fontSize: fontSize.caption,
          fontWeight: '700',
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function OptionRow({
  label,
  checked,
  multi,
  onPress,
}: {
  label: string;
  checked: boolean;
  multi: boolean;
  onPress: () => void;
}) {
  const { color } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: multi ? radius.sm : radius.full,
          borderWidth: 1,
          borderColor: checked ? color('primary') : color('border-strong'),
          backgroundColor: checked ? color('primary') : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <Text style={{ color: color('on-primary'), fontSize: 12, fontWeight: '800' }}>✓</Text>
        ) : null}
      </View>
      <Text style={{ flex: 1, color: color('text-primary'), fontSize: fontSize['body-sm'] }}>
        {label}
      </Text>
    </Pressable>
  );
}

function FieldLabel({ field }: { field: HelperField }) {
  const { color } = useTheme();
  return (
    <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption, fontWeight: '700' }}>
      {field.label}{field.required ? ' *' : ''}
    </Text>
  );
}

export function HelperFieldInput({
  field,
  value,
  onChange,
}: {
  field: HelperField;
  value: FormValue | undefined;
  onChange: (value: FormValue) => void;
}) {
  const { color } = useTheme();

  if (field.kind === 'confirm') {
    return (
      <OptionRow
        label={field.label}
        checked={value === true}
        multi
        onPress={() => onChange(value === true ? false : true)}
      />
    );
  }

  if (field.kind === 'single_select' || field.kind === 'multi_select') {
    const selected = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
    const single = field.kind === 'single_select';
    return (
      <View style={{ gap: space[2] }}>
        <FieldLabel field={field} />
        {(field.options ?? []).map((opt) => (
          <OptionRow
            key={opt.value}
            label={opt.label}
            checked={selected.includes(opt.value)}
            multi={!single}
            onPress={() => {
              if (single) {
                onChange(selected.includes(opt.value) ? null : opt.value);
              } else {
                onChange(selected.includes(opt.value)
                  ? selected.filter((v) => v !== opt.value)
                  : [...selected, opt.value]);
              }
            }}
          />
        ))}
      </View>
    );
  }

  const text = value == null ? '' : String(value);
  return (
    <View style={{ gap: space[1] }}>
      <FieldLabel field={field} />
      <TextInput
        value={text}
        onChangeText={(next) => onChange(field.kind === 'number' ? Number(next) || 0 : next)}
        placeholder={field.placeholder}
        placeholderTextColor={color('text-secondary')}
        keyboardType={field.kind === 'number' ? 'numeric' : 'default'}
        multiline={field.kind === 'textarea'}
        style={{
          minHeight: field.kind === 'textarea' ? 80 : 42,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color('border'),
          backgroundColor: color('surface'),
          color: color('text-primary'),
          fontSize: fontSize['body-sm'],
          paddingHorizontal: space[3],
          paddingVertical: space[2],
          textAlignVertical: field.kind === 'textarea' ? 'top' : 'center',
        }}
      />
    </View>
  );
}
