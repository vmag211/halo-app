import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'secondary' | 'tertiary' };
export default function Button({ busy = false, variant = 'primary', children, disabled, ...props }: Props) {
  return <button {...props} type={props.type ?? 'button'} className={`halo-button halo-${variant} ${props.className ?? ''}`} disabled={disabled || busy} aria-busy={busy || undefined}>
    <span className={busy ? 'halo-button-label-hidden' : undefined}>{children}</span>
    {busy && <span className="halo-spinner halo-button-spinner" aria-hidden="true" />}
  </button>;
}
