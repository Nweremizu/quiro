import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionLabel } from "../SectionLabel";
import { cn } from "@/lib/utils";

interface AiPreferences {
  selectedModel: string;
  anthropicKeySet: boolean;
  minimaxKeySet: boolean;
  providers: { anthropic: boolean; minimax: boolean };
}

const ANTHROPIC_MODELS = [
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

const MINIMAX_MODELS = [
  { value: "MiniMax-M3", label: "MiniMax M3" },
  { value: "MiniMax-M2.7", label: "MiniMax M2.7" },
  { value: "MiniMax-M2.5", label: "MiniMax M2.5" },
];

const ALL_MODELS = [...ANTHROPIC_MODELS, ...MINIMAX_MODELS];

function KeyInput({
  label,
  value,
  onChange,
  isSet,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isSet: boolean;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            isSet
              ? "bg-green-500/10 text-green-400"
              : "bg-foreground/10 text-muted-foreground",
          )}
        >
          {isSet ? "Connected" : "Not set"}
        </span>
      </div>
      <input
        ref={inputRef}
        type={focused ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={isSet ? "••••••••••••  (stored)" : placeholder}
        className={cn(
          "w-full rounded-md border bg-transparent px-3 py-1.5 text-xs text-foreground",
          "placeholder:text-muted-foreground/50 outline-none transition-colors",
          "border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/20",
        )}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

export function AiSettingsSection() {
  const [prefs, setPrefs] = useState<AiPreferences | null>(null);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [minimaxKey, setMinimaxKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("claude-opus-4-8");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.electronAPI.ai.getAiPreferences().then((p) => {
      setPrefs(p);
      setSelectedModel(p.selectedModel);
    });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const patch: { anthropicKey?: string; minimaxKey?: string; selectedModel?: string } = {
        selectedModel,
      };
      if (anthropicKey) patch.anthropicKey = anthropicKey;
      if (minimaxKey) patch.minimaxKey = minimaxKey;

      await window.electronAPI.ai.setAiPreferences(patch);

      // Refresh status
      const updated = await window.electronAPI.ai.getAiPreferences();
      setPrefs(updated);
      setAnthropicKey("");
      setMinimaxKey("");
      setSaveStatus("saved");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setSaving(false);
    }
  }, [anthropicKey, minimaxKey, selectedModel]);

  // Auto-save model selection changes
  useEffect(() => {
    if (!prefs) return;
    if (selectedModel === prefs.selectedModel) return;
    const t = setTimeout(() => {
      window.electronAPI.ai
        .setAiPreferences({ selectedModel })
        .then(() => window.electronAPI.ai.getAiPreferences())
        .then((p) => setPrefs(p));
    }, 400);
    return () => clearTimeout(t);
  }, [selectedModel, prefs]);

  const hasChanges = anthropicKey.length > 0 || minimaxKey.length > 0;

  return (
    <div className="space-y-6">
      {/* Model selection */}
      <section className="space-y-3">
        <SectionLabel>AI Model</SectionLabel>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-foreground">Active model</span>
          </div>
          <Select value={selectedModel} onValueChange={(v) => v && setSelectedModel(v)}>
            <SelectTrigger className="h-8 w-full rounded-md border-border bg-transparent text-xs text-foreground hover:bg-foreground/[0.03]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-popover text-popover-foreground shadow-lg">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Anthropic
              </div>
              {ANTHROPIC_MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
              <div className="mt-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                MiniMax
              </div>
              {MINIMAX_MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {prefs && (
            <p className="text-[10px] text-muted-foreground">
              {ALL_MODELS.find((m) => m.value === selectedModel)
                ? prefs.providers.anthropic || prefs.providers.minimax
                  ? "Ready to use"
                  : "Add an API key below to use this model"
                : "Custom model ID"}
            </p>
          )}
        </div>
      </section>

      {/* API keys */}
      <section className="space-y-4">
        <SectionLabel>API Keys</SectionLabel>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Keys are stored locally on your machine. Leave a field blank to keep
          the existing key.
        </p>

        <KeyInput
          label="Anthropic (Claude)"
          value={anthropicKey}
          onChange={setAnthropicKey}
          isSet={prefs?.anthropicKeySet ?? false}
          placeholder="sk-ant-api03-…"
        />

        <KeyInput
          label="MiniMax"
          value={minimaxKey}
          onChange={setMinimaxKey}
          isSet={prefs?.minimaxKeySet ?? false}
          placeholder="Your MiniMax API key"
        />

        {hasChanges && (
          <Button
            onClick={save}
            disabled={saving}
            size="sm"
            className="h-8 w-full text-xs"
          >
            {saving ? "Saving…" : "Save keys"}
          </Button>
        )}

        {saveStatus === "saved" && (
          <p className="text-center text-[10px] text-green-400">
            Keys saved successfully
          </p>
        )}
        {saveStatus === "error" && (
          <p className="text-center text-[10px] text-red-400">
            Failed to save keys
          </p>
        )}
      </section>

      {/* Clear a key */}
      {prefs && (prefs.anthropicKeySet || prefs.minimaxKeySet) && (
        <section className="space-y-2">
          <SectionLabel>Remove keys</SectionLabel>
          <div className="flex gap-2">
            {prefs.anthropicKeySet && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 border-red-500/20 bg-red-500/5 text-[10px] text-red-400 hover:border-red-500/30 hover:bg-red-500/10"
                onClick={async () => {
                  await window.electronAPI.ai.setAiPreferences({ anthropicKey: "" });
                  const p = await window.electronAPI.ai.getAiPreferences();
                  setPrefs(p);
                }}
              >
                Remove Anthropic key
              </Button>
            )}
            {prefs.minimaxKeySet && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 border-red-500/20 bg-red-500/5 text-[10px] text-red-400 hover:border-red-500/30 hover:bg-red-500/10"
                onClick={async () => {
                  await window.electronAPI.ai.setAiPreferences({ minimaxKey: "" });
                  const p = await window.electronAPI.ai.getAiPreferences();
                  setPrefs(p);
                }}
              >
                Remove MiniMax key
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
