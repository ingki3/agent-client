import { useMemo, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView, TextInput, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import type { AgentArtifact, AgentForm, AgentTask, FormField, FormValue, Message, TaskStatus } from "@/domain/entities";
import { Markdown } from "@/ui/markdown/Markdown";
import { useTasksStore } from "@/application/stores/tasks";
import { useArtifactsStore } from "@/application/stores/artifacts";
import { useFormsStore } from "@/application/stores/forms";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const TASK_LABEL: Record<TaskStatus, string> = {
  requested: "요청됨",
  running: "진행 중",
  needs_input: "입력 필요",
  review_needed: "검토 필요",
  completed: "완료",
  blocked: "막힘",
  archived: "보관됨",
};

const MUTABLE_STATUSES: TaskStatus[] = ["running", "completed", "blocked", "archived"];

export function AgentWorkCards({ message }: { message: Message }) {
  const tasks = useTasksStore((s) => s.byBuddy[message.buddyId] ?? []);
  const artifacts = useArtifactsStore((s) => s.byBuddy[message.buddyId] ?? []);
  const forms = useFormsStore((s) => s.byBuddy[message.buddyId] ?? []);
  const task = message.taskId ? tasks.find((t) => t.id === message.taskId) : undefined;
  const linkedArtifacts = (message.artifactIds ?? [])
    .map((id) => artifacts.find((a) => a.id === id))
    .filter((a): a is AgentArtifact => !!a);
  const form = message.formId ? forms.find((f) => f.id === message.formId) : undefined;

  if (!task && linkedArtifacts.length === 0 && !form) return null;
  return (
    <View style={{ marginTop: space[2], gap: space[2] }}>
      {task ? <TaskChip task={task} /> : null}
      {linkedArtifacts.map((a) => (
        <ArtifactCard key={a.id} artifact={a} />
      ))}
      {form ? <FormCard form={form} /> : null}
    </View>
  );
}

function TaskChip({ task }: { task: AgentTask }) {
  const { color } = useTheme();
  const setStatus = useTasksStore((s) => s.setStatus);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="작업 상태 변경"
        style={{
          alignSelf: "flex-start",
          backgroundColor: color("trace-summary"),
          borderRadius: radius.full,
          paddingHorizontal: space[3],
          paddingVertical: space[2],
        }}
      >
        <Text style={{ color: color("on-trace-summary"), fontSize: fontSize.caption, fontWeight: "700" }}>
          {TASK_LABEL[task.status]} · {task.title}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "#00000088", justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => undefined}
            style={{ backgroundColor: color("surface"), borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], padding: space[5], gap: space[3] }}
          >
            <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700" }}>{task.title}</Text>
            {MUTABLE_STATUSES.map((status) => (
              <Pressable
                key={status}
                onPress={() => {
                  setStatus(task.buddyId, task.id, status);
                  setOpen(false);
                }}
                style={{ minHeight: touch.min, justifyContent: "center" }}
              >
                <Text style={{ color: color(status === task.status ? "primary" : "text-primary"), fontSize: fontSize.body, fontWeight: "600" }}>
                  {TASK_LABEL[status]}
                </Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ArtifactCard({ artifact }: { artifact: AgentArtifact }) {
  const { color } = useTheme();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void Clipboard.setStringAsync(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const icon = artifact.kind === "code" ? "⌘" : artifact.kind === "json" ? "{}" : artifact.kind === "checklist" ? "☑" : "▤";
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          backgroundColor: color("surface-elevated"),
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color("border"),
          padding: space[3],
          gap: space[1],
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text style={{ color: color("primary"), fontSize: fontSize.body, fontWeight: "700" }}>{icon}</Text>
          <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], fontWeight: "700", flex: 1 }} numberOfLines={1}>
            {artifact.title}
          </Text>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>{artifact.kind}</Text>
        </View>
        <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }} numberOfLines={2}>
          {artifact.content.replace(/\s+/g, " ").slice(0, 140)}
        </Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: color("surface"), padding: space[4], gap: space[3] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingTop: space[6] }}>
            <Pressable onPress={() => setOpen(false)} hitSlop={8}>
              <Text style={{ color: color("primary"), fontSize: fontSize.body }}>닫기</Text>
            </Pressable>
            <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700", flex: 1 }} numberOfLines={1}>
              {artifact.title}
            </Text>
            <Pressable onPress={copy} hitSlop={8}>
              <Text style={{ color: color("primary"), fontSize: fontSize.body }}>{copied ? "복사됨" : "복사"}</Text>
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }}>
            {artifact.kind === "markdown" || artifact.kind === "checklist" || artifact.kind === "table" ? (
              <Markdown text={artifact.content} />
            ) : (
              <Text selectable style={{ fontFamily: MONO, color: color("text-primary"), fontSize: fontSize.code, lineHeight: fontSize.code * 1.5 }}>
                {artifact.content}
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function initialValue(field: FormField): FormValue {
  if (field.kind === "multi_select") return [];
  if (field.kind === "confirm") return false;
  return "";
}

function FormCard({ form }: { form: AgentForm }) {
  const { color } = useTheme();
  const submit = useFormsStore((s) => s.submit);
  const cancel = useFormsStore((s) => s.cancel);
  const initial = useMemo(() => Object.fromEntries(form.fields.map((f) => [f.id, form.values?.[f.id] ?? initialValue(f)])), [form]);
  const [values, setValues] = useState<Record<string, FormValue>>(initial);
  const [busy, setBusy] = useState(false);
  const disabled = form.status !== "pending" || busy;
  const canSubmit = form.fields.every((f) => !f.required || valuePresent(values[f.id], f));

  const setValue = (id: string, value: FormValue) => setValues((v) => ({ ...v, [id]: value }));

  return (
    <View
      style={{
        backgroundColor: color("surface-elevated"),
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color("border"),
        padding: space[3],
        gap: space[3],
      }}
    >
      <View style={{ gap: space[1] }}>
        <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], fontWeight: "700" }}>{form.title}</Text>
        {form.description ? <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>{form.description}</Text> : null}
      </View>
      {form.fields.map((field) => (
        <FormFieldView key={field.id} field={field} value={values[field.id]} disabled={disabled} onChange={(v) => setValue(field.id, v)} />
      ))}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[2] }}>
        {form.cancelLabel ? (
          <Pressable
            disabled={disabled}
            onPress={async () => {
              setBusy(true);
              await cancel(form.buddyId, form.id);
              setBusy(false);
            }}
            style={{ minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[3] }}
          >
            <Text style={{ color: color(disabled ? "text-disabled" : "text-secondary"), fontSize: fontSize["body-sm"], fontWeight: "600" }}>
              {form.cancelLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          disabled={disabled || !canSubmit}
          onPress={async () => {
            setBusy(true);
            await submit(form.buddyId, form.id, values);
            setBusy(false);
          }}
          style={{
            minHeight: touch.min,
            justifyContent: "center",
            paddingHorizontal: space[4],
            borderRadius: radius.full,
            backgroundColor: color(!disabled && canSubmit ? "primary" : "border"),
          }}
        >
          <Text style={{ color: color(!disabled && canSubmit ? "on-primary" : "text-disabled"), fontSize: fontSize["body-sm"], fontWeight: "700" }}>
            {form.status === "submitted" ? "제출됨" : form.status === "cancelled" ? "취소됨" : form.submitLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function valuePresent(value: FormValue | undefined, field: FormField): boolean {
  if (field.kind === "confirm") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  return value !== "" && value != null;
}

function FormFieldView({
  field,
  value,
  disabled,
  onChange,
}: {
  field: FormField;
  value: FormValue | undefined;
  disabled: boolean;
  onChange: (value: FormValue) => void;
}) {
  const { color } = useTheme();
  const label = `${field.label}${field.required ? " *" : ""}`;
  if (field.kind === "single_select" || field.kind === "multi_select") {
    const selected = Array.isArray(value) ? value : value ? [String(value)] : [];
    return (
      <View style={{ gap: space[2] }}>
        <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>{label}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {(field.options ?? []).map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <Pressable
                key={opt.value}
                disabled={disabled}
                onPress={() => {
                  if (field.kind === "single_select") onChange(opt.value);
                  else onChange(isSelected ? selected.filter((x) => x !== opt.value) : [...selected, opt.value]);
                }}
                style={{
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: isSelected ? color("primary") : color("border"),
                  backgroundColor: isSelected ? color("trace-summary") : color("surface"),
                  paddingHorizontal: space[3],
                  paddingVertical: space[2],
                }}
              >
                <Text style={{ color: color(isSelected ? "on-trace-summary" : "text-primary"), fontSize: fontSize.caption, fontWeight: "600" }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }
  if (field.kind === "confirm") {
    return (
      <Pressable
        disabled={disabled}
        onPress={() => onChange(value !== true)}
        style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: touch.min }}
      >
        <Text style={{ color: color(value === true ? "primary" : "text-secondary"), fontSize: fontSize["title-sm"] }}>
          {value === true ? "☑" : "☐"}
        </Text>
        <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], flex: 1 }}>{label}</Text>
      </Pressable>
    );
  }
  if (field.kind === "file") {
    return (
      <View style={{ gap: space[2] }}>
        <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>{label}</Text>
        <Pressable
          disabled={disabled}
          onPress={async () => {
            const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
            if (!res.canceled && res.assets?.[0]) onChange(res.assets[0].uri);
          }}
          style={{ borderWidth: 1, borderColor: color("border"), borderRadius: radius.md, padding: space[3] }}
        >
          <Text style={{ color: color(value ? "text-primary" : "text-secondary"), fontSize: fontSize["body-sm"] }} numberOfLines={1}>
            {value ? String(value).split("/").pop() : field.placeholder ?? "파일 선택"}
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ gap: space[2] }}>
      <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>{label}</Text>
      <TextInput
        value={value == null ? "" : String(value)}
        editable={!disabled}
        keyboardType={field.kind === "number" ? "numeric" : "default"}
        placeholder={field.placeholder ?? (field.kind === "date" ? "YYYY-MM-DD" : "")}
        placeholderTextColor={color("text-secondary")}
        onChangeText={(t) => onChange(field.kind === "number" ? (t ? Number(t) : "") : t)}
        style={{
          backgroundColor: color("surface"),
          borderWidth: 1,
          borderColor: color("border"),
          borderRadius: radius.md,
          color: color("text-primary"),
          fontSize: fontSize["body-sm"],
          paddingHorizontal: space[3],
          paddingVertical: space[2],
        }}
      />
    </View>
  );
}
