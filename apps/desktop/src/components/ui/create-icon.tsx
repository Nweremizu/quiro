import React from 'react';
import type { HugeiconsProps } from '@hugeicons/react';

import type { IconProps } from './icon';
import { Icon } from './icon';

export function createIcon(icon: HugeiconsProps['icon']) {
  const WrappedIcon = React.forwardRef<SVGSVGElement, IconProps>(
    (props, ref) => {
      return <Icon ref={ref} icon={icon} {...props} />;
    }
  );

  WrappedIcon.displayName = 'WrappedIcon';

  return WrappedIcon;
}
