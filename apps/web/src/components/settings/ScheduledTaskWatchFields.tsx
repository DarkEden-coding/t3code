import { MAX_WATCH_TIMEOUT_MS } from "@t3tools/contracts";
import {
  emptyWatchEnvDraft,
  type WatchDraft,
  type WatchEnvDraft,
} from "@t3tools/client-runtime/scheduled-task-watch";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { T, useGT } from "gt-react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

function WatchEnvField({
  env,
  onChange,
}: {
  env: ReadonlyArray<WatchEnvDraft>;
  onChange: (env: ReadonlyArray<WatchEnvDraft>) => void;
}) {
  const gt = useGT();
  const update = (id: string, patch: Partial<WatchEnvDraft>) =>
    onChange(env.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <Label>
            <T>Environment variables</T>
          </Label>
          <p className="text-sm text-muted-foreground">
            <T>
              Put tokens here, not in the command. Values are stored apart from the task and are
              never shown again; leave a stored value empty to keep it.
            </T>
          </p>
        </div>
        <Button
          className="shrink-0"
          variant="outline"
          size="sm"
          onClick={() => onChange([...env, emptyWatchEnvDraft()])}
        >
          <PlusIcon />
          <T>Add variable</T>
        </Button>
      </div>
      {env.map((variable, index) => (
        <div key={variable.id} className="flex items-center gap-2">
          <div className="grid w-40 shrink-0 grid-cols-1">
            <Input
              aria-label={gt("Variable {number} name", { number: index + 1 })}
              // oxlint-disable-next-line t3code/no-untranslated-copy -- an environment variable name
              placeholder="SLACK_TOKEN"
              value={variable.name}
              onChange={(event) => update(variable.id, { name: event.target.value })}
            />
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-1">
            <Input
              aria-label={gt("Variable {number} value", { number: index + 1 })}
              type={variable.secret ? "password" : "text"}
              autoComplete="off"
              placeholder={variable.stored ? gt("Stored") : ""}
              value={variable.value}
              onChange={(event) => update(variable.id, { value: event.target.value })}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Checkbox
              id={`watch-env-secret-${variable.id}`}
              checked={variable.secret}
              disabled={variable.stored && variable.value === ""}
              onCheckedChange={(secret) => update(variable.id, { secret })}
            />
            <Label htmlFor={`watch-env-secret-${variable.id}`}>
              <T>Secret</T>
            </Label>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={gt("Remove variable {number}", { number: index + 1 })}
            onClick={() => onChange(env.filter((entry) => entry.id !== variable.id))}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
    </div>
  );
}

/** The command, change detection and env of a watch task. Filters and the interval live in the form. */
export function ScheduledTaskWatchFields({
  watch,
  intervalMinutes,
  onChange,
  onIntervalChange,
}: {
  watch: WatchDraft;
  intervalMinutes: string;
  onChange: (watch: WatchDraft) => void;
  onIntervalChange: (minutes: string) => void;
}) {
  const gt = useGT();
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {gt(
          "The command runs in the project folder without a model. The first poll records what it sees; later polls run the prompt only when that changes. Use {items}, {count}, {value} or {previous} in the prompt.",
          {
            items: "{{items}}",
            count: "{{items.length}}",
            value: "{{value}}",
            previous: "{{previous}}",
          },
        )}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="scheduled-task-watch-command">
          <T>Command</T>
        </Label>
        <Textarea
          id="scheduled-task-watch-command"
          placeholder="./scripts/list-dms.sh"
          value={watch.command}
          onChange={(event) => onChange({ ...watch, command: event.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>
          <T>Run the prompt for</T>
        </Label>
        <ToggleGroup
          aria-label={gt("What counts as a change")}
          value={[watch.mode]}
          onValueChange={(values) => {
            const mode = values[0];
            if (mode === "items" || mode === "value") onChange({ ...watch, mode });
          }}
        >
          <Toggle value="items">
            <T>New items</T>
          </Toggle>
          <Toggle value="value">
            <T>A changed value</T>
          </Toggle>
        </ToggleGroup>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="scheduled-task-watch-path">
            {watch.mode === "items" ? gt("List path") : gt("Value path")}
          </Label>
          <Input
            id="scheduled-task-watch-path"
            placeholder={gt("Whole output")}
            value={watch.path}
            onChange={(event) => onChange({ ...watch, path: event.target.value })}
          />
        </div>
        {watch.mode === "items" ? (
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="scheduled-task-watch-id-path">
              <T>Item id path</T>
            </Label>
            <Input
              id="scheduled-task-watch-id-path"
              placeholder="id"
              value={watch.idPath}
              onChange={(event) => onChange({ ...watch, idPath: event.target.value })}
            />
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="scheduled-task-watch-interval">
            <T>Poll every</T>
          </Label>
          <Input
            type="number"
            id="scheduled-task-watch-interval"
            nativeInput
            min={1}
            className="w-20"
            value={intervalMinutes}
            onChange={(event) => onIntervalChange(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            <T>minutes</T>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="scheduled-task-watch-timeout">
            <T>Time out after</T>
          </Label>
          <Input
            type="number"
            id="scheduled-task-watch-timeout"
            nativeInput
            min={1}
            max={MAX_WATCH_TIMEOUT_MS / 1000}
            className="w-20"
            value={watch.timeoutSeconds}
            onChange={(event) => onChange({ ...watch, timeoutSeconds: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">
            <T>seconds</T>
          </span>
        </div>
      </div>
      <WatchEnvField env={watch.env} onChange={(env) => onChange({ ...watch, env })} />
    </div>
  );
}
