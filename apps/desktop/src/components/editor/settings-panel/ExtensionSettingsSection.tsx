import { useState, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { extensionHost } from "@/lib/extensions/extensionHost";

export type ExtensionSettingsField = {
  id: string;
  label: string;
  type: "color" | "text" | "number" | "select" | "toggle" | "slider";
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
};

function ExtensionFieldRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
      <span className="flex-shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function getNumericFieldValue(field: ExtensionSettingsField, value: unknown) {
  if (typeof value === "number") return value;
  if (typeof field.defaultValue === "number") return field.defaultValue;
  return 0;
}

export function ExtensionSettingsSection({
  extensionId,
  label,
  fields,
}: {
  extensionId: string;
  label: string;
  fields: ExtensionSettingsField[];
}) {
  const [, forceUpdate] = useState(0);
  const refresh = () => forceUpdate((count) => count + 1);
  const setSetting = (fieldId: string, nextValue: unknown) => {
    extensionHost.setExtensionSetting(extensionId, fieldId, nextValue);
    refresh();
  };

  return (
    <div className="rounded-lg border border-foreground/10 bg-background/60 px-3 py-3">
      <div className="mb-2 text-[11px] font-medium text-foreground">
        {label}
      </div>
      <div className="space-y-1.5">
        {fields.map((field) => {
          const value = extensionHost.getExtensionSetting(
            extensionId,
            field.id,
          );

          if (field.type === "color") {
            return (
              <ExtensionFieldRow key={field.id} label={field.label}>
                <input
                  type="color"
                  value={String(value ?? field.defaultValue ?? "#000000")}
                  onChange={(event) => setSetting(field.id, event.target.value)}
                  className="h-5 w-7 cursor-pointer rounded border border-foreground/10 bg-transparent"
                />
              </ExtensionFieldRow>
            );
          }

          if (field.type === "text") {
            return (
              <ExtensionFieldRow key={field.id} label={field.label}>
                <input
                  type="text"
                  value={String(value ?? field.defaultValue ?? "")}
                  onChange={(event) => setSetting(field.id, event.target.value)}
                  className="h-6 w-24 rounded border border-foreground/10 bg-foreground/[0.06] px-1.5 text-[10px] text-foreground"
                />
              </ExtensionFieldRow>
            );
          }

          if (field.type === "number" || field.type === "slider") {
            const numericValue = getNumericFieldValue(field, value);
            return (
              <ExtensionFieldRow key={field.id} label={field.label}>
                <div className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={field.min ?? 0}
                    max={field.max ?? 1}
                    step={field.step ?? 0.01}
                    value={numericValue}
                    onChange={(event) =>
                      setSetting(field.id, parseFloat(event.target.value))
                    }
                    className="h-1 w-20 accent-primary"
                  />
                  <span className="w-8 text-right font-mono text-[10px] text-muted-foreground/70">
                    {numericValue.toFixed(1)}
                  </span>
                </div>
              </ExtensionFieldRow>
            );
          }

          if (field.type === "toggle") {
            return (
              <ExtensionFieldRow key={field.id} label={field.label}>
                <Switch
                  checked={Boolean(value ?? field.defaultValue ?? false)}
                  onCheckedChange={(nextValue) =>
                    setSetting(field.id, nextValue)
                  }
                  className="scale-75 data-[state=checked]:bg-primary"
                />
              </ExtensionFieldRow>
            );
          }

          if (field.type === "select" && field.options) {
            return (
              <ExtensionFieldRow key={field.id} label={field.label}>
                <Select
                  value={String(value ?? field.defaultValue ?? "")}
                  onValueChange={(nextValue) => setSetting(field.id, nextValue)}
                >
                  <SelectTrigger className="h-6 w-24 border-foreground/10 bg-foreground/[0.03] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="text-[10px]"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ExtensionFieldRow>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
