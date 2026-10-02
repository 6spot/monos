import type { ReactNode } from 'react';

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return <header className="page-header"><h1>{title}</h1>{children && <div className="page-header-actions">{children}</div>}</header>;
}
