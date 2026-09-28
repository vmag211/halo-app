import { CircleAlert } from 'lucide-react';
import { copy } from '@/lib/frontend/copy';
export default function ErrorCallout({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="halo-callout" role="alert"><div className="halo-callout-title"><CircleAlert size={18} aria-hidden="true" /><p>{message}</p></div>{retry && <button className="halo-text-button" type="button" onClick={retry}>{copy.common.retry}</button>}</div>;
}
