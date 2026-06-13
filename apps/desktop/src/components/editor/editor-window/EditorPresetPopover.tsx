import type { FormEvent } from "react";

import {
  ArrowDown01Icon,
  Bookmark01Icon,
  Cancel01Icon,
  Tick02Icon,
} from "@/components/icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { useI18n } from "@/contexts/I18nContext";

import { cn } from "@/lib/utils";

import type { EditorPreset } from "@/components/editor/utils/editor-preferences";

interface EditorPresetPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  presets: EditorPreset[];

  currentPresetId: string | undefined;
  currentPresetName: string | undefined;

  presetNameDraft: string;

  onPresetNameDraftChange: (value: string) => void;

  onSavePreset: () => void;

  onApplyPreset: (presetId: string) => void;

  onDeletePreset: (presetId: string) => void;
}

export function EditorPresetPopover({
  open,
  onOpenChange,

  presets,

  currentPresetId,
  currentPresetName,

  presetNameDraft,

  onPresetNameDraftChange,

  onSavePreset,

  onApplyPreset,

  onDeletePreset,
}: EditorPresetPopoverProps) {
  const { t } = useI18n();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    onSavePreset();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className={cn(
          "group inline-flex items-center gap-1.5",
          "rounded-md px-2 py-1.5",
          "text-[12px] font-medium tracking-[-0.01em]",
          "text-muted-foreground",
          "transition-colors duration-80",
          "hover:text-accent-foreground",
          "focus-visible:outline-none",
          "focus-visible:ring-2",
          "focus-visible:ring-(--border-focus)/40",
        )}
      >
        <span className="flex items-center gap-1.5">
          <Bookmark01Icon className="size-3.5" />

          <span className="max-w-35 truncate">
            {currentPresetName ?? t("editor.presets.label", "Presets")}
          </span>
        </span>

        <ArrowDown01Icon
          className={cn(
            "size-3.5 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={10}
        className={cn(
          "w-[320px] overflow-hidden",
          "rounded-2xl",
          "border border-(--border-default)",
          "bg-(--bg-surface)/96",
          "backdrop-blur-xl",
          "p-0",
          "text-(--text-primary)",
          "shadow-(--shadow-xl)",
        )}
      >
        {/* <div className="px-4 py-3 pb-0">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex size-7 items-center justify-center",
                "rounded-lg",
                "bg-(--bg-brand-subtle)",
                "text-accent-foreground",
              )}
            >
              <Bookmark01Icon className="size-3.5" />
            </div>

            <div>
              <p className="text-[13px] font-semibold tracking-[-0.02em]">
                {t("editor.presets.label", "Presets")}
              </p>

              <p className="text-[11px] text-muted-foreground">
                Save and reuse editor configurations
              </p>
            </div>
          </div>
        </div> */}

        <div className="space-y-4 p-4">
          <form onSubmit={handleSubmit} className="space-y-2.5">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-(--text-tertiary)">
                {t("editor.presets.saveCurrentAs", "Save current preset as")}
              </p>

              <div className="flex items-center gap-2">
                <Input
                  value={presetNameDraft}
                  onChange={(event) =>
                    onPresetNameDraftChange(event.target.value)
                  }
                  placeholder={t(
                    "editor.presets.namePlaceholder",
                    "Preset name",
                  )}
                  aria-label={t(
                    "editor.presets.namePlaceholder",
                    "Preset name",
                  )}
                  className={cn(
                    "h-8 rounded-lg",
                    "border-(--border-default)",
                    "bg-muted",
                    "text-[12px]",
                    "shadow-none",
                    "transition-colors",
                    "focus-visible:ring-(--border-focus)/30",
                  )}
                />

                <Button
                  type="submit"
                  disabled={!presetNameDraft.trim()}
                  className={cn(
                    "h-8 rounded-lg px-3",
                    "bg-primary",
                    "text-[11px] font-semibold",
                    "text-(--text-inverse)",
                    "shadow-none",
                    "transition-all duration-80",
                    "hover:bg-(--bg-brand-hover)",
                    "active:scale-[0.98]",
                  )}
                >
                  {t("common.actions.save", "Save")}
                </Button>
              </div>
            </div>
          </form>

          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-(--text-tertiary)">
              {t("editor.presets.savedList", "Saved presets")}
            </p>

            <div className="max-h-65 space-y-1 overflow-y-auto pr-1 source-selector-scroll">
              {presets.length === 0 ? (
                <div
                  className={cn(
                    "flex min-h-23 items-center justify-center",
                    "rounded-xl border border-dashed",
                    "border-(--border-default)",
                    "bg-muted",
                    "px-4 text-center",
                  )}
                >
                  <p className="text-[11px] text-muted-foreground">
                    {t("editor.presets.empty", "No presets saved yet.")}
                  </p>
                </div>
              ) : (
                presets.map((preset) => {
                  const isCurrent = preset.id === currentPresetId;

                  return (
                    <div
                      key={preset.id}
                      className={cn(
                        "group flex items-center gap-1",
                        "rounded-xl border",
                        "transition-all duration-80",

                        isCurrent
                          ? [
                              "border-primary/70",
                              "bg-(--bg-brand-subtle)",
                              "shadow-[0_0_0_1px_rgba(240,128,48,0.08)]",
                            ]
                          : [
                              "border-transparent",
                              "hover:border-subtle",
                              "hover:bg-secondary",
                            ],
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onApplyPreset(preset.id)}
                        className={cn(
                          "flex min-w-0 flex-1 items-center justify-between",
                          "px-3 py-2.5",
                          "text-left",
                          "outline-none",
                        )}
                      >
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "truncate text-[12px] font-medium tracking-[-0.01em]",
                              isCurrent
                                ? "text-(--text-primary)"
                                : "text-muted-foreground",
                            )}
                          >
                            {preset.name}
                          </p>
                        </div>

                        {isCurrent ? (
                          <div
                            className={cn(
                              "ml-3 flex size-5 items-center justify-center",
                              "rounded-full",
                              "bg-primary",
                              "text-(--text-inverse)",
                              "shadow-[0_0_12px_rgba(240,128,48,0.22)]",
                            )}
                          >
                            <Tick02Icon className="size-3" />
                          </div>
                        ) : null}
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeletePreset(preset.id)}
                        className={cn(
                          "mr-1 inline-flex size-7 shrink-0 items-center justify-center",
                          "rounded-lg",
                          "text-(--text-tertiary)",
                          "transition-colors duration-80",
                          "hover:bg-(--bg-danger-subtle)",
                          "hover:text-(--text-danger)",
                          "focus-visible:outline-none",
                          "focus-visible:ring-2",
                          "focus-visible:ring-red-500/20",
                        )}
                        aria-label={t(
                          "editor.presets.deleteAriaLabel",
                          "Delete preset {{name}}",
                          { name: preset.name },
                        )}
                        title={t(
                          "editor.presets.deleteAriaLabel",
                          "Delete preset {{name}}",
                          { name: preset.name },
                        )}
                      >
                        <Cancel01Icon className="size-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
