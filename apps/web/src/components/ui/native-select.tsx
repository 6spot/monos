import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.ts';

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <span className="relative inline-flex min-w-0"><select data-slot="native-select" className={cn('h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-surface py-1 pl-3 pr-8 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 max-md:min-h-11', className)} {...props} /><ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /></span>;
}
