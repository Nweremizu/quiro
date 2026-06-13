import type { HugeiconsProps, IconSvgElement } from '@hugeicons/react';
import { HugeiconsIcon } from '@hugeicons/react';

export type IconProps = Omit<HugeiconsProps, 'icon'>;

type BaseIconProps = IconProps & {
  icon: HugeiconsProps['icon'];
};

export function Icon({
  icon,
  size = 24,
  color = 'currentColor',
  strokeWidth = 1.5,
  ...props
}: BaseIconProps) {
  return (
    <HugeiconsIcon
      icon={icon as IconSvgElement}
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}
