import { CircleAlert } from 'lucide-react';
export default function FieldError({ id, message }: { id: string; message?: string | null }) {
  return <div className="halo-error" id={id} role={message ? 'alert' : undefined}>{message && <><CircleAlert size={16} aria-hidden="true" /><span>{message}</span></>}</div>;
}
