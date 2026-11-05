import type { ReactNode } from 'react';

export function Field({ label, error, hint, children, wide }: {
  label: string;
  error?: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`a-field${wide ? ' a-field-wide' : ''}${error ? ' has-error' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && !error && <small>{hint}</small>}
      {error && <small className="a-field-error" role="alert">{error}</small>}
    </label>
  );
}
