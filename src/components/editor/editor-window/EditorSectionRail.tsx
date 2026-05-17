import { motion } from "motion/react";
import type { ElementType } from "react";
import { UserCircleIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { EditorEffectSection } from "@/types/editor";

export type EditorSectionButton = {
  id: EditorEffectSection;
  label: string;
  icon: ElementType<{ className?: string }>;
};

type EditorSectionRailProps = {
  activeSection: EditorEffectSection;
  sections: EditorSectionButton[];
  onSectionChange: (section: EditorEffectSection) => void;
  onAccountClick: () => void;
};

export function EditorSectionRail({
  activeSection,
  sections,
  onSectionChange,
  onAccountClick,
}: EditorSectionRailProps) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 px-2 py-2">
      {sections.map((section) => {
        const isActive = activeSection === section.id;
        const Icon = section.icon;

        return (
          <div key={section.id} className="flex items-center">
            <motion.button
              type="button"
              onClick={() => onSectionChange(section.id)}
              title={section.label}
              className={cn(
                "group relative flex size-9 items-center justify-center rounded transition-colors",
                "outline-none focus:outline-none focus-visible:outline-none",
              )}
              animate={{ opacity: isActive ? 1 : 0.6 }}
              transition={{ duration: 0.14 }}
            >
              {isActive && (
                <motion.span
                  layoutId="rail-bg-active"
                  className="absolute inset-0 rounded-lg bg-foreground/8"
                  transition={{
                    type: "spring",
                    stiffness: 450,
                    damping: 35,
                  }}
                />
              )}
              <motion.span
                className="relative z-10"
                animate={{
                  color: isActive
                    ? "hsl(var(--text-brand))"
                    : "hsl(var(--foreground))",
                }}
                transition={{ duration: 0.14 }}
              >
                <Icon className="h-6.75 w-6.75" />
              </motion.span>
            </motion.button>
            <div className="ml-1.5 h-1.5 w-1.5 shrink-0">
              {isActive && (
                <motion.span
                  layoutId="rail-active-dot"
                  className="block h-1.5 w-1.5 rounded-full bg-primary"
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 32,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-0.5 pt-3">
        <motion.button
          type="button"
          onClick={onAccountClick}
          title="Account"
          className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-foreground/55 outline-none transition hover:text-foreground focus:outline-none focus-visible:outline-none"
          whileHover={{ opacity: 1 }}
          initial={{ opacity: 0.55 }}
        >
          <motion.span className="absolute inset-0 rounded-lg bg-foreground/4 opacity-0 transition group-hover:opacity-100" />
          <UserCircleIcon className="relative z-10 size-6.75" />
        </motion.button>
      </div>
    </div>
  );
}
