import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.ts';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="label" className={cn('text-[13px] font-medium leading-[18px] text-foreground', className)} {...props} />;
}
