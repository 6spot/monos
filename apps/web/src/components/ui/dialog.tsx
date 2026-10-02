import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils.ts';
import { Button } from './button.tsx';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogContent({ className, children, side, ...props }: DialogPrimitive.Popup.Props & { side?: 'left' }) {
  return <DialogPrimitive.Portal><DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/35" /><DialogPrimitive.Popup data-slot={side ? 'sheet' : 'dialog'} className={cn('fixed z-50 flex flex-col gap-4 border border-border bg-surface-raised p-6 text-foreground shadow-xl outline-none', side ? 'inset-y-0 left-0 w-[min(320px,90vw)] overflow-y-auto' : 'left-1/2 top-1/2 max-h-[90dvh] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl', className)} {...props}>{children}<DialogPrimitive.Close render={<Button variant="ghost" size="icon" className="absolute right-3 top-3" aria-label="Close dialog" />}><X size={18} /></DialogPrimitive.Close></DialogPrimitive.Popup></DialogPrimitive.Portal>;
}
