import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from './ui/button.tsx';
import { Input } from './ui/input.tsx';
import { Textarea } from './ui/textarea.tsx';
import { Label } from './ui/label.tsx';
import { NativeSelect } from './ui/native-select.tsx';
import { Checkbox } from './ui/checkbox.tsx';
import { PageHeader } from './page-header.tsx';
import type { ConfigurationCommand, ConfigurationResult } from '../../../../packages/protocol/generated/types.ts';

export type Save = (name: ConfigurationCommand['name'], payload: ConfigurationCommand['payload'], basis: number) => Promise<ConfigurationResult | undefined>;
export interface Draft<T> { value: T; basis: number }
export function Field({ label, hint, error, multiline = false, onChange, ...props }: { label: string; hint?: string; error?: string; multiline?: boolean; value: string; onChange: (value: string) => void; rows?: number; type?: string; min?: number; max?: number; step?: number; required?: boolean; minLength?: number; maxLength?: number; disabled?: boolean; readOnly?: boolean; placeholder?: string; autoComplete?: string }) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return <div className="field"><Label htmlFor={id}>{label}</Label>{multiline ? <Textarea id={id} aria-describedby={describedBy} aria-invalid={!!error || undefined} {...props} onChange={(event) => onChange(event.target.value)} /> : <Input id={id} aria-describedby={describedBy} aria-invalid={!!error || undefined} {...props} onChange={(event) => onChange(event.target.value)} />}{hint && <p id={`${id}-hint`} className="hint">{hint}</p>}{error && <p id={`${id}-error`} className="form-error" role="alert">{error}</p>}</div>;
}
export function Select({ label, children, ...props }: ComponentProps<'select'> & { label: string; children: ReactNode }) {
  const id = useId(); return <div className="field"><Label htmlFor={id}>{label}</Label><NativeSelect id={id} {...props}>{children}</NativeSelect></div>;
}
export function CheckField({ label, checked, onCheckedChange, disabled }: { label: ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return <Label className="checkbox-field" htmlFor={id}><Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} /><span>{label}</span></Label>;
}
export function PageHeading({ title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <><PageHeader title={title}>{action}</PageHeader><p className="page-description">{description}</p></>;
}
export function EditorActions({ dirty, disabled, reload }: { dirty: boolean; disabled: boolean; reload: () => void }) {
  return <div className="editor-actions"><span className="hint">{dirty ? 'Unsaved changes' : 'Saved configuration'}</span><div><Button type="button" variant="outline" disabled={disabled} onClick={reload}>Reload saved version</Button><Button type="submit" disabled={disabled}>Save changes</Button></div></div>;
}
