import { CircleCheck, CircleHelp, Info, TriangleAlert, OctagonAlert, Octagon } from 'lucide-react';
import { copy } from '@/lib/frontend/copy';
const icons = {good:CircleCheck,moderate:Info,elevated:TriangleAlert,high:OctagonAlert,severe:Octagon,no_data:CircleHelp};
export default function SeverityPill({ severity }: { severity?: string | null }) {
  const key = severity && Object.hasOwn(icons, severity) ? severity as keyof typeof icons : 'no_data';
  const Icon = icons[key];
  return <span className="halo-severity" data-severity={key}><Icon size={16} aria-hidden="true" />{copy.severity[key]}</span>;
}
