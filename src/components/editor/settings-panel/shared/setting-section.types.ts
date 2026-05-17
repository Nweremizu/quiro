export interface SectionHeaderProps {
  title: string;
  onReset?: () => void;
  resetLabel?: string;
  className?: string;
  children?: React.ReactNode;
}

export interface SettingsToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export interface ResetButtonProps {
  onClick: () => void;
  label?: string;
  className?: string;
}
