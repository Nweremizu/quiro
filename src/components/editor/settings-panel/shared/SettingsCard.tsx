import { cn } from "@/lib/utils";

export interface SettingsCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function SettingsCard({
  children,
  className,
  ...props
}: SettingsCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg bg-foreground/3 px-2.5 py-2 space-y-3",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
