import type { ReactElement } from "react";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { HudPopover } from "./PopoverScaffold";
import ProjectBrowserDialog from "../../editor/dialog/ProjectBrowserDialog";
import type { ProjectLibraryEntry } from "../../editor/dialog/ProjectBrowserDialog";

const POPOVER_ID = "projects";

export function ProjectPopover({
  trigger,
  entries,
  onOpenProject,
}: {
  trigger: ReactElement;
  entries: ProjectLibraryEntry[];
  onOpenProject: (projectPath: string) => void;
}) {
  const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
  const open = isOpen(POPOVER_ID);

  return (
    <HudPopover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestClose(POPOVER_ID);
          return;
        }
        requestOpen(POPOVER_ID);
      }}
      trigger={trigger}
      align="center"
      className="w-fit"
    >
      <ProjectBrowserDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) requestClose(POPOVER_ID);
        }}
        entries={entries}
        renderMode="inline"
        onOpenProject={(path) => {
          onOpenProject(path);
          requestClose(POPOVER_ID);
        }}
      />
    </HudPopover>
  );
}
