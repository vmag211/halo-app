'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AccordionRow, Callout, Card, ToggleChip } from '@/components/ui/Foundation';
import Button from '@/components/ui/Button';
import { errorCode, FrontendError } from '@/lib/frontend/api';
import { copy } from '@/lib/frontend/copy';
import { emptyHousehold, isProfileComplete, normalizeHousehold, normalizeWaterAnswer, parseHomeYear, validateHomeYear } from '@/lib/frontend/onboarding';
import { clearReadings } from '@/lib/frontend/storage';
import { householdKeys, type Household, type HouseholdKey, type ProfileResponse } from '@/lib/frontend/types';
import { useStageSession } from './StageSession';

const labels: Record<HouseholdKey, string> = { has_toddler: 'Toddlers', has_child: 'Children', has_teen: 'Teens', has_adult: 'Adults', has_senior: 'Seniors', has_pregnant: 'Pregnancy', has_respiratory: 'Respiratory conditions' };
type Draft = { household: Household; year: string; water: string };
type EditedField = HouseholdKey | 'year' | 'water';
type SaveKind = 'household' | 'home';
const emptyDraft = (): Draft => ({ household: emptyHousehold(), year: '', water: '' });
function fromProfile(profile: ProfileResponse | null): Draft {
  return { household: normalizeHousehold(profile?.household), year: profile?.profile?.home_year == null ? '' : String(profile.profile.home_year), water: normalizeWaterAnswer(profile?.profile?.water_source ?? '') ?? '' };
}
function mergeDraft(current: Draft, fresh: Draft, edited: ReadonlySet<EditedField>): Draft {
  return { household: Object.fromEntries(householdKeys.map(key => [key, edited.has(key) ? current.household[key] : fresh.household[key]])) as Household, year: edited.has('year') ? current.year : fresh.year, water: edited.has('water') ? current.water : fresh.water };
}

/** Explicit saves keep drafts local. Read the current profile before each write
 * so unedited fields cannot overwrite a change made in another tab. */
export default function StageSettings() {
  const router = useRouter();
  const { api, profile, offline, restart } = useStageSession();
  const [draft, setDraft] = useState<Draft>(() => fromProfile(profile));
  const [baseline, setBaseline] = useState<Draft>(() => fromProfile(profile));
  const [open, setOpen] = useState<SaveKind | null>('household');
  const [busy, setBusy] = useState<SaveKind | null>(null);
  const [failure, setFailure] = useState<{ kind: SaveKind; text: string } | null>(null);
  const [success, setSuccess] = useState('');
  const [errors, setErrors] = useState<{ year?: string; water?: string }>({});
  const edited = useRef(new Set<EditedField>());
  const request = useRef<AbortController | null>(null);
  const blocked = useRef(false);
  const [identityChanged, setIdentityChanged] = useState(false);
  const yearInput = useRef<HTMLInputElement>(null);
  const waterInput = useRef<HTMLSelectElement>(null);
  const ready = !!profile && isProfileComplete(profile) && !identityChanged;
  const disabled = !ready || !!busy || offline;
  const householdDirty = householdKeys.some(key => draft.household[key] !== baseline.household[key]);
  const homeDirty = draft.year !== baseline.year || draft.water !== baseline.water;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const intent = new URL(window.location.href).searchParams.get('open');
      if (intent === 'home' || intent === 'household') setOpen(intent);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!profile) return;
    const fresh = fromProfile(profile);
    let active = true;
    queueMicrotask(() => {
      if (!active || blocked.current) return;
      setBaseline(fresh); setDraft(current => mergeDraft(current, fresh, edited.current));
    });
    return () => { active = false; };
  }, [profile]);
  useEffect(() => {
    blocked.current = false;
    const reset = () => {
      blocked.current = true; request.current?.abort(); request.current = null; edited.current.clear();
      setBusy(null); setDraft(emptyDraft()); setBaseline(emptyDraft()); setFailure(null); setSuccess(''); setErrors({}); setIdentityChanged(true);
    };
    window.addEventListener('halo:identity-changed', reset);
    return () => { blocked.current = true; request.current?.abort(); window.removeEventListener('halo:identity-changed', reset); };
  }, []);

  function changeHousehold(key: HouseholdKey) {
    if (disabled) return;
    const value = !draft.household[key];
    if (value === baseline.household[key]) edited.current.delete(key); else edited.current.add(key);
    setSuccess(''); setFailure(null);
    setDraft(current => ({ ...current, household: { ...current.household, [key]: value } }));
  }
  function changeHome(key: 'year' | 'water', value: string) {
    if (value === baseline[key]) edited.current.delete(key); else edited.current.add(key);
    setSuccess(''); setFailure(null);
    setDraft(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: key === 'year' ? validateHomeYear(value) ? current.year : undefined : normalizeWaterAnswer(value) ? undefined : current.water }));
  }
  function validateHome() {
    const next = { year: validateHomeYear(draft.year), water: normalizeWaterAnswer(draft.water) ? '' : 'Choose where your water comes from.' };
    setErrors(next);
    if (next.year) yearInput.current?.focus(); else if (next.water) waterInput.current?.focus();
    return !next.year && !next.water;
  }
  async function save(kind: SaveKind) {
    if (disabled || blocked.current || request.current || !(kind === 'household' ? householdDirty : homeDirty)) return;
    if (kind === 'home' && !validateHome()) return;
    const controller = new AbortController(); request.current = controller;
    const changes = new Set(edited.current);
    setBusy(kind); setFailure(null); setSuccess('');
    const active = () => !controller.signal.aborted && !blocked.current;
    try {
      const owner = await api.getIdentity?.();
      if (!active()) return;
      if (!owner) throw new FrontendError('signin_failed');
      const currentProfile = await api.getProfile(controller.signal);
      if (!active()) return;
      if (!isProfileComplete(currentProfile)) throw new FrontendError('no_location');
      const currentOwner = await api.getIdentity?.();
      if (!active()) return;
      if (currentOwner !== owner) throw new FrontendError('session_changed');
      const fresh = fromProfile(currentProfile);
      const submitted = mergeDraft(draft, fresh, changes);
      if (kind === 'household') await api.saveHousehold(submitted.household, controller.signal);
      else await api.saveHome({ water_source: submitted.water, home_year: parseHomeYear(submitted.year) }, controller.signal);
      if (!active()) return;
      if (await api.getIdentity?.() !== owner) throw new FrontendError('session_changed');
      if (!active()) return;
      const saved = kind === 'household' ? { ...fresh, household: submitted.household } : { ...fresh, year: submitted.year, water: submitted.water };
      const savedKeys: EditedField[] = kind === 'household' ? [...householdKeys] : ['year', 'water'];
      for (const key of savedKeys) edited.current.delete(key);
      setBaseline(saved); setDraft(current => mergeDraft(current, saved, edited.current));
      const message = kind === 'household' ? 'Household saved.' : 'Home details saved.';
      setSuccess(message); clearReadings();
      window.dispatchEvent(new CustomEvent('halo:settings-changed', { detail: { message } }));
    } catch (error) {
      if (!active()) return;
      const code = errorCode(error);
      if (code === 'session_changed' || code === 'signin_failed') {
        blocked.current = true; edited.current.clear(); setIdentityChanged(true); setDraft(emptyDraft()); setBaseline(emptyDraft());
      }
      setFailure({ kind, text: `${copy.errors[code] || copy.errors.generic} Your changes have not been confirmed.` });
    } finally {
      if (request.current === controller) { request.current = null; setBusy(null); }
    }
  }
  function changeAddress() {
    if (disabled) return;
    const message = householdDirty || homeDirty ? 'Unsaved changes on this page will be discarded. Continue to change address?' : 'Changing address replaces the location used for your readings. Continue?';
    if (window.confirm(message)) router.push('/onboarding?change=1');
  }
  function reloadProfile() { blocked.current = false; setIdentityChanged(false); setFailure(null); void restart(); }
  const selected = householdKeys.filter(key => draft.household[key]).map(key => labels[key]);

  return <div className="halo-f-stack">
    <div className="halo-f-intro"><h2>Your home and household</h2><p>Keep the details behind your guidance up to date.</p></div>
    {!ready && <Callout tone="notice"><p>{identityChanged ? 'Your session changed. Reload your profile before editing.' : 'Household controls remain unavailable until the current profile has loaded.'}</p><Button variant="secondary" onClick={reloadProfile} aria-label="Reload profile">Reload profile</Button></Callout>}
    {failure && <Callout tone="error"><p>{failure.text}</p>{ready && <p>Your answers are still here. Use Save again to retry.</p>}</Callout>}
    {!!success && <p role="status">{success}</p>}
    <div className="halo-f-card">
      <AccordionRow id="stage-household-options" title="Household" summary={selected.join(', ') || 'No categories selected'} open={open === 'household'} onToggle={() => setOpen(open === 'household' ? null : 'household')}>
        <p>Optional. Choose any that apply. Categories shape guidance, not environmental measurements or scores.</p>
        <div className="halo-f-chips">{householdKeys.map(key => <ToggleChip key={key} pressed={draft.household[key]} disabled={disabled} onToggle={() => changeHousehold(key)}>{labels[key]}</ToggleChip>)}</div>
        <Button variant="secondary" disabled={disabled || !householdDirty} busy={busy === 'household'} aria-label="Save household" onClick={() => { void save('household'); }}>Save household</Button>
      </AccordionRow>
      <AccordionRow id="stage-home-options" title="Home details" summary={draft.year ? `Built in ${draft.year}` : 'Water source and building year'} open={open === 'home'} onToggle={() => setOpen(open === 'home' ? null : 'home')}>
        <form className="halo-f-form" onSubmit={event => { event.preventDefault(); void save('home'); }}>
          <label className="halo-f-field">Year your home was built<span className="halo-f-meta">Optional</span><input ref={yearInput} className="halo-input" inputMode="numeric" maxLength={4} value={draft.year} disabled={disabled} aria-invalid={!!errors.year} aria-describedby={errors.year ? 'stage-year-error' : undefined} onBlur={() => setErrors(current => ({ ...current, year: validateHomeYear(draft.year) }))} onChange={event => changeHome('year', event.target.value.replace(/\D/g, ''))} />{errors.year && <span id="stage-year-error" className="halo-error">{errors.year}</span>}</label>
          <label className="halo-f-field">Water source<select ref={waterInput} className="halo-select" value={draft.water} disabled={disabled} aria-invalid={!!errors.water} aria-describedby={errors.water ? 'stage-water-error' : undefined} onChange={event => changeHome('water', event.target.value)}><option value="">Choose a source</option><option value="utility">Public water system</option><option value="well">Private well</option><option value="spring">Spring</option><option value="other">Other / Not sure</option></select>{errors.water && <span id="stage-water-error" className="halo-error">{errors.water}</span>}</label>
          <Button type="submit" variant="secondary" disabled={disabled || !homeDirty} busy={busy === 'home'} aria-label="Save home details">Save home details</Button>
        </form>
      </AccordionRow>
    </div>
    <Card title="Location"><p>Changing your address replaces the location used for your environmental readings. You can review your household and home details during setup.</p><Button variant="secondary" onClick={changeAddress} disabled={disabled}>Change address</Button></Card>
  </div>;
}
