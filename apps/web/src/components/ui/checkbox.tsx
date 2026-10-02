import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils.ts';

// A native button keeps the visible control inside native fieldset disabled
// semantics as well as Base UI's keyboard, controlled-state and hidden-input API.
export function Checkbox({ className, ...props }: Omit<CheckboxPrimitive.Root.Props, 'render' | 'nativeButton' | 'className'> & { className?: string }) {
  return <CheckboxPrimitive.Root
    {...props}
    nativeButton
    render={<button type="button" />}
    data-slot="checkbox"
    className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-surface text-primary-foreground outline-none data-checked:border-primary data-checked:bg-primary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-50', className)}
  ><CheckboxPrimitive.Indicator data-slot="checkbox-indicator"><Check className="size-3" aria-hidden="true" /></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>;
}
