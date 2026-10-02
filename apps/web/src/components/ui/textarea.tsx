import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.ts';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn('flex min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-surface px-3 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 aria-invalid:border-destructive', className)} {...props} />;
}
