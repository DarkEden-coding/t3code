import {
  emptyWatchEnvDraft,
  type WatchDraft,
  type WatchEnvDraft,
} from "@t3tools/client-runtime/scheduled-task-watch";
import { T, useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { ThemedSwitch } from "../../../components/ui/ThemedSwitch";
import { FormField, SelectRow } from "./ScheduledTaskFormRows";

function WatchEnvRows(props: {
  readonly env: ReadonlyArray<WatchEnvDraft>;
  readonly disabled: boolean;
  readonly onChange: (env: ReadonlyArray<WatchEnvDraft>) => void;
}) {
  const gt = useGT();
  const update = (id: string, patch: Partial<WatchEnvDraft>) =>
    props.onChange(
      props.env.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)),
    );
  return (
    <>
      {props.env.map((variable, index) => (
        <View key={variable.id}>
          <View className="flex-row items-center gap-3 border-t border-border-subtle px-4 pt-3">
            <Text className="min-w-0 flex-1 text-sm text-foreground-muted">
              {gt("Variable {number}", { number: index + 1 })}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Remove variable {number}", { number: index + 1 })}
              disabled={props.disabled}
              hitSlop={8}
              onPress={() => props.onChange(props.env.filter((entry) => entry.id !== variable.id))}
              className="active:opacity-70"
            >
              <SymbolView name="trash" size={16} tintColorClassName="accent-danger-foreground" />
            </Pressable>
          </View>
          <FormField
            label={gt("Variable {number} name", { number: index + 1 })}
            value={variable.name}
            // oxlint-disable-next-line t3code/no-untranslated-copy -- an environment variable name
            placeholder="SLACK_TOKEN"
            plain
            disabled={props.disabled}
            onChange={(name) => update(variable.id, { name })}
          />
          <FormField
            label={gt("Variable {number} value", { number: index + 1 })}
            value={variable.value}
            placeholder={variable.stored ? gt("Stored") : undefined}
            secureTextEntry={variable.secret}
            plain
            disabled={props.disabled}
            onChange={(value) => update(variable.id, { value })}
          />
          <View className="min-h-12 flex-row items-center gap-3 px-4 pb-3">
            <Text textRole="body" className="min-w-0 flex-1 text-foreground">
              <T>Secret</T>
            </Text>
            <ThemedSwitch
              accessibilityLabel={gt("Secret")}
              value={variable.secret}
              disabled={props.disabled || (variable.stored && variable.value === "")}
              onValueChange={(secret) => update(variable.id, { secret })}
            />
          </View>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={props.disabled}
        onPress={() => props.onChange([...props.env, emptyWatchEnvDraft()])}
        className="min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:opacity-70"
      >
        <Text textRole="body" className="min-w-0 flex-1 text-foreground">
          <T>Add variable</T>
        </Text>
        <SymbolView name="plus" size={16} tintColorClassName="accent-icon" />
      </Pressable>
      <Text className="px-4 pb-3 text-sm text-foreground-muted">
        <T>
          Put tokens here, not in the command. Values are stored apart from the task and are never
          shown again; leave a stored value empty to keep it.
        </T>
      </Text>
    </>
  );
}

/** The command, change detection and env of a watch task. Filters live in the form. */
export function ScheduledTaskWatchFields(props: {
  readonly watch: WatchDraft;
  readonly intervalMinutes: string;
  readonly disabled: boolean;
  readonly onChange: (update: (watch: WatchDraft) => WatchDraft) => void;
  readonly onIntervalChange: (minutes: string) => void;
}) {
  const gt = useGT();
  const set = (patch: Partial<WatchDraft>) => props.onChange((watch) => ({ ...watch, ...patch }));
  const modes = [
    { id: "items", title: gt("New items") },
    { id: "value", title: gt("A changed value") },
  ] as const;
  return (
    <>
      <Text className="border-t border-border-subtle px-4 py-3 text-sm text-foreground-muted">
        {gt(
          "The command runs in the project folder without a model. The first poll records what it sees; later polls run the prompt only when that changes. Use {items}, {count}, {value} or {previous} in the prompt.",
          {
            items: "{{items}}",
            count: "{{items.length}}",
            value: "{{value}}",
            previous: "{{previous}}",
          },
        )}
      </Text>
      <FormField
        label={gt("Command")}
        value={props.watch.command}
        placeholder="./scripts/list-dms.sh"
        plain
        disabled={props.disabled}
        borderTop
        onChange={(command) => set({ command })}
      />
      <SelectRow
        label={gt("Run the prompt for")}
        value={modes.find((mode) => mode.id === props.watch.mode)?.title ?? ""}
        actions={modes.map((mode) => ({
          id: mode.id,
          title: mode.title,
          state: mode.id === props.watch.mode ? ("on" as const) : undefined,
        }))}
        onSelect={(id) => {
          if (id === "items" || id === "value") set({ mode: id });
        }}
        borderTop
      />
      <FormField
        label={props.watch.mode === "items" ? gt("List path") : gt("Value path")}
        value={props.watch.path}
        placeholder={gt("Whole output")}
        plain
        disabled={props.disabled}
        borderTop
        onChange={(path) => set({ path })}
      />
      {props.watch.mode === "items" ? (
        <FormField
          label={gt("Item id path")}
          value={props.watch.idPath}
          placeholder="id"
          plain
          disabled={props.disabled}
          borderTop
          onChange={(idPath) => set({ idPath })}
        />
      ) : null}
      <FormField
        label={gt("Poll every (minutes)")}
        value={props.intervalMinutes}
        keyboardType="decimal-pad"
        disabled={props.disabled}
        borderTop
        onChange={props.onIntervalChange}
      />
      <FormField
        label={gt("Time out after (seconds)")}
        value={props.watch.timeoutSeconds}
        keyboardType="number-pad"
        disabled={props.disabled}
        borderTop
        onChange={(timeoutSeconds) => set({ timeoutSeconds })}
      />
      <WatchEnvRows
        env={props.watch.env}
        disabled={props.disabled}
        onChange={(env) => set({ env })}
      />
    </>
  );
}
