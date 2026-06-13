import { TransactionHistoryIcon } from "@/components/icons";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { APP_HEADER_ICON_BUTTON_CLASS } from "../help";
import type { EditorHistoryEntry } from "./types";

interface EditorHistoryPopoverProps {
  entries: EditorHistoryEntry[];
  currentEntryId: string | null;
  onJumpTo: (entryId: string) => void;
}

function formatHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function EditorHistoryPopover({
  entries,
  currentEntryId,
  onJumpTo,
}: EditorHistoryPopoverProps) {
  const orderedEntries = [...entries].reverse();

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          APP_HEADER_ICON_BUTTON_CLASS,
          "flex items-center justify-center rounded-full",
        )}
        title="History"
        aria-label="History"
      >
        <TransactionHistoryIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={10} className="w-80 gap-3 p-3">
        <PopoverHeader className="gap-1 px-1">
          <PopoverTitle className="text-[13px] font-semibold tracking-[-0.01em]">
            History
          </PopoverTitle>
          <PopoverDescription className="text-[11px] leading-4">
            Jump through recent editor actions without losing redo states.
          </PopoverDescription>
        </PopoverHeader>

        <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
          {orderedEntries.length === 0 ? (
            <div className="px-1 py-5 text-center text-[11px] text-muted-foreground">
              No editor actions yet.
            </div>
          ) : (
            orderedEntries.map((entry) => {
              const isCurrent = entry.id === currentEntryId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onJumpTo(entry.id)}
                  className={cn(
                    "grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                    isCurrent
                      ? "bg-primary/[0.08] text-foreground"
                      : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      isCurrent ? "bg-primary" : "bg-muted-foreground/35",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium leading-4">
                      {entry.label}
                    </span>
                    <span className="block truncate text-[10px] leading-3 text-muted-foreground/70">
                      {formatHistoryTime(entry.createdAt)}
                      {isCurrent ? " · Current" : ""}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

