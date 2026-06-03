import { useMemo, useState, type ReactNode } from "react";
import { View, Text, Pressable, TextInput, ScrollView } from "react-native";
import type { FormValue, HelperField, HelperItem, Message } from "@/domain/entities";
import { uid } from "@/lib/id";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { useBuddiesStore } from "@/application/stores/buddies";
import { useArtifactsStore } from "@/application/stores/artifacts";
import { relayClient } from "@/infrastructure/api/relayClient";
import { useChatStore } from "@/application/stores/chat";

export function HelperActionCards({ message }: { message: Message }) {
  const items = message.helperItems ?? [];
  if (message.inlineKeyboard?.rows.length) return null;
  if (items.length === 0) return null;
  return (
    <View style={{ marginTop: space[2], gap: space[2] }}>
      {items.map((item) => (
        <HelperItemCard key={item.id} item={item} message={message} />
      ))}
    </View>
  );
}

function tgMessageId(id: string): number | undefined {
  const m = id.match(/^tg-(\d+)$/);
  return m ? Number(m[1]) : undefined;
}

function displayActionValue(payload: {
  action: "submit" | "cancel" | "revise" | "quick_reply" | "save_artifact";
  label?: string;
  value?: string;
  values?: Record<string, FormValue>;
}): string {
  if (payload.value?.trim()) return payload.value.trim();
  if (payload.label?.trim()) return payload.label.trim();
  if (payload.action === "cancel") return "취소";
  if (payload.action === "revise") return "수정 요청";
  if (payload.action === "save_artifact") return "산출물로 저장";
  if (payload.values) {
    const selected = payload.values.selected;
    if (Array.isArray(selected) && selected.length) return selected.join(", ");
  }
  return "선택 완료";
}

function unique(xs: string[]): string[] {
  return Array.from(new Set(xs.filter(Boolean)));
}

function compactMessageContext(message: Message, textLimit: number) {
  const urlsFromText = message.text.match(/https?:\/\/[^\s)\]}>"']+/gi) ?? [];
  const handles = message.text.match(/(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|@[A-Za-z0-9_]{2,})/g) ?? [];
  const urls = unique([...(message.preview?.url ? [message.preview.url] : []), ...urlsFromText]).slice(0, 8);
  return {
    messageId: tgMessageId(message.id),
    role: message.role,
    text: message.text.slice(0, textLimit),
    excerpt: message.text.replace(/\s+/g, " ").trim().slice(0, 500),
    urls,
    handles: unique(handles).slice(0, 12),
    preview: message.preview
      ? {
          url: message.preview.url,
          title: message.preview.title,
          description: message.preview.description,
          siteName: message.preview.siteName,
        }
      : undefined,
    attachments: message.attachments?.map((a) => ({ kind: a.kind, name: a.name, mime: a.mime, size: a.size })).slice(0, 8),
  };
}

function sourceContext(message: Message, timeline: Message[]) {
  const idx = timeline.findIndex((m) => m.id === message.id);
  const recent = (idx >= 0 ? timeline.slice(Math.max(0, idx - 4), idx + 1) : [message]).slice(-5);
  return {
    ...compactMessageContext(message, 3000),
    recentMessages: recent.map((m) => compactMessageContext(m, 1200)),
  };
}

function HelperItemCard({
  item,
  message,
}: {
  item: HelperItem;
  message: Message;
}) {
  const { color } = useTheme();
  const buddyId = message.buddyId;
  const [done, setDone] = useState(false);
  const buddy = useBuddiesStore((s) => s.buddies.find((b) => b.id === buddyId));
  const addArtifact = useArtifactsStore((s) => s.upsertFromPayload);
  const appendLocalUserMessage = useChatStore((s) => s.appendLocalUserMessage);
  const appendLocalSystemMessage = useChatStore((s) => s.appendLocalSystemMessage);
  const timeline = useChatStore((s) => s.byBuddy[buddyId] ?? []);
  const send = async (payload: {
    action: "submit" | "cancel" | "revise" | "quick_reply" | "save_artifact";
    label?: string;
    value?: string;
    values?: Record<string, FormValue>;
  }) => {
    const display = displayActionValue(payload);
    if (!buddy?.botId) {
      appendLocalSystemMessage(buddyId, "후속 액션을 보낼 대상 agent 연결을 찾지 못했습니다.");
      return false;
    }
    setDone(true);
    appendLocalUserMessage(buddyId, display);
    const ok = await relayClient.submitHelperAction(buddy.botId, {
      helperItemId: item.id,
      helperType: item.type,
      source: sourceContext(message, timeline),
      ...payload,
    });
    if (!ok) {
      setDone(false);
      appendLocalSystemMessage(buddyId, "후속 액션 전송에 실패했습니다. 네트워크 또는 relay 연결을 확인해 주세요.");
    }
    return ok;
  };

  if (item.type === "quick_replies") {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
        {item.options.map((opt) => (
          <Pressable
            key={opt.value}
            disabled={done}
            onPress={() => void send({ action: "quick_reply", label: opt.label, value: opt.value })}
            style={{
              backgroundColor: color(done ? "border" : "trace-summary"),
              borderRadius: radius.full,
              paddingHorizontal: space[3],
              paddingVertical: space[2],
            }}
          >
            <Text style={{ color: color(done ? "text-disabled" : "on-trace-summary"), fontSize: fontSize.caption, fontWeight: "700" }}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  if (item.type === "single_select" || item.type === "multi_select") {
    const [selected, setSelected] = useState<string[]>([]);
    const toggle = (value: string) => {
      if (item.type === "single_select") setSelected([value]);
      else setSelected((xs) => (xs.includes(value) ? xs.filter((x) => x !== value) : [...xs, value]));
    };
    return (
      <Shell title={item.title} description={item.description} done={done}>
        <View style={{ gap: space[2] }}>
          {item.options.map((opt) => {
            const on = selected.includes(opt.value);
            return (
              <Pressable key={opt.value} disabled={done} onPress={() => toggle(opt.value)} style={{ flexDirection: "row", gap: space[2], alignItems: "center" }}>
                <Text style={{ color: color(on ? "primary" : "text-secondary"), fontSize: fontSize["title-sm"] }}>{on ? "☑" : "☐"}</Text>
                <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], flex: 1 }}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <SubmitButton
          label={done ? "전달됨" : item.submitLabel}
          disabled={done || selected.length === 0}
          onPress={() => void send({
            action: "submit",
            value: item.options.filter((opt) => selected.includes(opt.value)).map((opt) => opt.label).join(", "),
            values: { selected },
          })}
        />
      </Shell>
    );
  }

  if (item.type === "input_form") {
    return <InputForm item={item} done={done} onSubmit={(values) => send({ action: "submit", value: item.submitLabel, values })} onCancel={() => send({ action: "cancel" })} />;
  }

  if (item.type === "confirm_action") {
    return (
      <Shell title={item.title} description={item.description} done={done}>
        {item.summary?.length ? (
          <View style={{ gap: space[1] }}>
            {item.summary.map((s, i) => (
              <Text key={i} style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>• {s}</Text>
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] }}>
          {item.cancelLabel ? <GhostButton label={item.cancelLabel} disabled={done} onPress={() => void send({ action: "cancel" })} /> : null}
          {item.reviseLabel ? <GhostButton label={item.reviseLabel} disabled={done} onPress={() => void send({ action: "revise" })} /> : null}
          <SubmitButton label={done ? "전달됨" : item.confirmLabel} disabled={done} onPress={() => void send({ action: "submit", value: item.confirmLabel })} />
        </View>
      </Shell>
    );
  }

  if (item.type === "artifact_suggestion") {
    return (
      <Shell title={item.title} done={done}>
        <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }} numberOfLines={2}>
          {item.artifact.title}
        </Text>
        <SubmitButton
          label={done ? "저장됨" : "산출물로 저장"}
          disabled={done}
          onPress={async () => {
            addArtifact(buddyId, { ...item.artifact, id: uid("artifact") }, message.id);
            await send({ action: "save_artifact", values: { title: item.artifact.title, kind: item.artifact.kind } });
          }}
        />
      </Shell>
    );
  }

  return null;
}

function Shell({ title, description, done, children }: { title: string; description?: string; done?: boolean; children: ReactNode }) {
  const { color } = useTheme();
  return (
    <View style={{ backgroundColor: color("surface-elevated"), borderWidth: 1, borderColor: color("border"), borderRadius: radius.md, padding: space[3], gap: space[3], opacity: done ? 0.72 : 1 }}>
      <View style={{ gap: space[1] }}>
        <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], fontWeight: "700" }}>{title}</Text>
        {description ? <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>{description}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function SubmitButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable disabled={disabled} onPress={onPress} style={{ alignSelf: "flex-end", minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[4], borderRadius: radius.full, backgroundColor: color(disabled ? "border" : "primary") }}>
      <Text style={{ color: color(disabled ? "text-disabled" : "on-primary"), fontSize: fontSize["body-sm"], fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function GhostButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable disabled={disabled} onPress={onPress} style={{ minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[2] }}>
      <Text style={{ color: color(disabled ? "text-disabled" : "text-secondary"), fontSize: fontSize["body-sm"], fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function initialValue(field: HelperField): FormValue {
  if (field.kind === "multi_select") return [];
  if (field.kind === "confirm") return false;
  return "";
}

function InputForm({
  item,
  done,
  onSubmit,
  onCancel,
}: {
  item: Extract<HelperItem, { type: "input_form" }>;
  done: boolean;
  onSubmit: (values: Record<string, FormValue>) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
}) {
  const values0 = useMemo(() => Object.fromEntries(item.fields.map((f) => [f.id, initialValue(f)])), [item.fields]);
  const [values, setValues] = useState<Record<string, FormValue>>(values0);
  const canSubmit = item.fields.every((f) => !f.required || present(values[f.id], f));
  return (
    <Shell title={item.title} description={item.description} done={done}>
      {item.fields.map((field) => (
        <FieldInput key={field.id} field={field} value={values[field.id]} disabled={done} onChange={(v) => setValues((prev) => ({ ...prev, [field.id]: v }))} />
      ))}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[2] }}>
        {item.cancelLabel ? <GhostButton label={item.cancelLabel} disabled={done} onPress={() => void onCancel()} /> : null}
        <SubmitButton label={done ? "전달됨" : item.submitLabel} disabled={done || !canSubmit} onPress={() => void onSubmit(values)} />
      </View>
    </Shell>
  );
}

function present(value: FormValue | undefined, field: HelperField): boolean {
  if (field.kind === "confirm") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  return value !== "" && value != null;
}

function FieldInput({ field, value, disabled, onChange }: { field: HelperField; value?: FormValue; disabled: boolean; onChange: (value: FormValue) => void }) {
  const { color } = useTheme();
  const label = `${field.label}${field.required ? " *" : ""}`;
  if (field.kind === "single_select" || field.kind === "multi_select") {
    const selected = Array.isArray(value) ? value : value ? [String(value)] : [];
    return (
      <View style={{ gap: space[2] }}>
        <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>{label}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {(field.options ?? []).map((opt) => {
            const on = selected.includes(opt.value);
            return (
              <Pressable
                key={opt.value}
                disabled={disabled}
                onPress={() => onChange(field.kind === "single_select" ? opt.value : on ? selected.filter((x) => x !== opt.value) : [...selected, opt.value])}
                style={{ borderRadius: radius.full, borderWidth: 1, borderColor: color(on ? "primary" : "border"), paddingHorizontal: space[3], paddingVertical: space[2] }}
              >
                <Text style={{ color: color("text-primary"), fontSize: fontSize.caption }}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }
  if (field.kind === "confirm") {
    return (
      <Pressable disabled={disabled} onPress={() => onChange(value !== true)} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: touch.min }}>
        <Text style={{ color: color(value === true ? "primary" : "text-secondary"), fontSize: fontSize["title-sm"] }}>{value === true ? "☑" : "☐"}</Text>
        <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], flex: 1 }}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: space[2] }}>
      <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>{label}</Text>
      <TextInput
        editable={!disabled}
        multiline={field.kind === "textarea"}
        keyboardType={field.kind === "number" ? "numeric" : "default"}
        value={value == null ? "" : String(value)}
        placeholder={field.placeholder}
        placeholderTextColor={color("text-secondary")}
        onChangeText={(t) => onChange(field.kind === "number" ? (t ? Number(t) : "") : t)}
        style={{ color: color("text-primary"), backgroundColor: color("surface"), borderWidth: 1, borderColor: color("border"), borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2], minHeight: field.kind === "textarea" ? 84 : undefined }}
      />
    </View>
  );
}
