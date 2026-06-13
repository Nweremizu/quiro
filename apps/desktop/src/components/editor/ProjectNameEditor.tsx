"use client";

import { Edit01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface ProjectNameEditorProps {
  displayValue: string;
  hasUnsavedChanges?: boolean;
  suffix?: string;
  /** Return true if the save succeeded, false to stay in edit mode */
  onSave: (name: string) => Promise<boolean>;
}

// Strong ease-out: starts fast, feels decisive and responsive
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export function ProjectNameEditor({
  displayValue,
  hasUnsavedChanges = false,
  suffix = ".quiro",
  onSave,
}: ProjectNameEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(displayValue);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setDraft(displayValue);
  }, [displayValue, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isEditing]);

  const enterEdit = () => {
    setDraft(displayValue);
    setIsEditing(true);
  };

  const cancel = () => {
    setDraft(displayValue);
    setIsEditing(false);
  };

  const confirm = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      cancel();
      return;
    }
    setIsSaving(true);
    try {
      const saved = await onSave(trimmed);
      if (saved) {
        setIsEditing(false);
      } else {
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      layout
      className={cn(
        // Keep border always present so CSS can transition its color
        "flex items-center gap-1 border",
        "transition-[background-color,box-shadow,border-color] duration-150",
        isEditing
          ? "rounded-[7px] border-foreground/10 bg-background px-2.5 py-1 shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
          : "group cursor-pointer rounded-md border-transparent px-2 py-1 hover:bg-foreground/5",
      )}
      onClick={!isEditing ? enterEdit : undefined}
      whileTap={!isEditing ? { scale: 0.97 } : undefined}
      transition={{ layout: { duration: 0.15, ease: EASE_OUT } }}
    >
      {hasUnsavedChanges && (
        <span className="mt-px size-2 shrink-0 rounded-full bg-primary" />
      )}

      <input
        ref={inputRef}
        type="text"
        value={isEditing ? draft : displayValue}
        onChange={(e) => setDraft(e.target.value)}
        readOnly={!isEditing}
        disabled={isSaving}
        onBlur={() => {
          if (isEditing && !isSaving) cancel();
        }}
        onKeyDown={(e) => {
          if (!isEditing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
          if (e.key === "Enter") {
            e.preventDefault();
            void confirm();
          }
        }}
        className={cn(
          "border-0 bg-transparent p-0 text-sm font-semibold tracking-tight outline-none rounded-md",
          isEditing
            ? "min-w-[10ch] max-w-[min(40vw,360px)] cursor-text text-foreground/95 disabled:cursor-wait px-2 py-1 group-hover:text-foreground/100"
            : "cursor-pointer truncate text-foreground/90 ",
        )}
        style={{
          width: isEditing
            ? `${Math.max(draft.length, 10)}ch`
            : `${Math.max(displayValue.length, 6)}ch`,
          height: "auto",
        }}
        aria-label="Project name"
      />

      <span className="shrink-0 text-xs font-medium tracking-tight text-muted-foreground/70">
        {suffix}
      </span>

      {/*
       * Concurrent AnimatePresence (no mode): edit icon exits while check
       * button enters simultaneously — no dead frame between states.
       */}
      <AnimatePresence initial={false}>
        {!isEditing ? (
          <motion.span
            key="edit"
            initial={{ x: 6, opacity: 0 }}
            animate={{ x: 0, opacity: 0.4 }}
            exit={{ x: 6, opacity: 0 }}
            transition={{ type: "spring", duration: 0.2, bounce: 0 }}
            className="shrink-0 text-foreground"
          >
            <HugeiconsIcon icon={Edit01Icon} size={12} />
          </motion.span>
        ) : isSaving ? (
          <motion.span
            key="saving"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ type: "spring", duration: 0.2, bounce: 0 }}
            className="flex shrink-0 items-center"
          >
            <Spinner size={14} />
          </motion.span>
        ) : (
          <motion.button
            key="confirm"
            type="button"
            initial={{ x: 8, scale: 0.8, opacity: 0 }}
            animate={{ x: 0, scale: 1, opacity: 1 }}
            exit={{ x: 8, scale: 0.8, opacity: 0 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.25 }}
            whileTap={{ scale: 0.88 }}
            onMouseDown={(e) => {
              // Prevent blur from firing cancel before confirm runs
              e.preventDefault();
              void confirm();
            }}
            className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            aria-label="Save project name"
          >
            <HugeiconsIcon icon={Tick02Icon} size={12} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
