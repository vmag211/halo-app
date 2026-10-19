'use client';

import { useHomeDraft } from '@/components/homeguard/HomeWorkspaceState';

/** External review tooling, never a product control or live operation simulator. */
export default function LunaActionReviewControls() {
  const [outcome, setOutcome] = useHomeDraft('luna:action-outcome', 'saved');
  const [check, setCheck] = useHomeDraft('luna:action-check', 'unknown');
  return <>
    <label>Assistant action review outcome<select value={outcome} onChange={event => setOutcome(event.target.value)}><option value="saved">Saved</option><option value="unknown-not-applied">Unknown, no write occurred</option><option value="unknown-applied">Unknown, write occurred</option></select></label>
    <label>Assistant action status check<select value={check} onChange={event => setCheck(event.target.value)}><option value="unknown">Still unknown</option><option value="resolved">Resolve from the operation ledger</option></select></label>
  </>;
}
