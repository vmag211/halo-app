import LunaMark from '@/components/foundation/LunaMark';
import { LoadingSymbol } from '@/components/ui/HaloLoading';

/** The facets settle after one cycle; the quiet orbit remains while truly pending. */
export default function LunaLoading({ label = 'Thinking it through', detail }: { label?: string; detail?: string }) {
  return <div className="halo-luna-loading" role="status" aria-live="polite" aria-atomic="true">
    <LoadingSymbol><LunaMark size={32} loading /></LoadingSymbol>
    <span>{label}{detail && <small>{detail}</small>}</span>
  </div>;
}
