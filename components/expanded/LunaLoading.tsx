import LunaMark from '@/components/foundation/LunaMark';

/** The caller supplies a truthful phase. The mark settles after one short cycle. */
export default function LunaLoading({ label = 'Thinking it through', detail }: { label?: string; detail?: string }) {
  return <div className="halo-luna-loading" role="status" aria-live="polite" aria-atomic="true">
    <LunaMark size={38} loading />
    <span>{label}{detail && <small>{detail}</small>}</span>
  </div>;
}
