import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.ts';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn('flex h-9 w-full min-w-0 rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 aria-invalid:border-destructive max-md:min-h-11', className)} {...props} />;
}
