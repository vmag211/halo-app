"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, Check, Plus, WifiOff } from 'lucide-react';
import WelcomeTitle from '@/components/onboarding/WelcomeTitle';
import ResultsReveal from '@/components/onboarding/ResultsReveal';
import Button from '@/components/ui/Button';
import FieldError from '@/components/ui/FieldError';
import ErrorCallout from '@/components/ui/ErrorCallout';
import { copy } from '@/lib/frontend/copy';
import { createLiveOnboardingApi, errorCode, FrontendError } from '@/lib/frontend/api';
import { emptyHousehold, normalizeHousehold, normalizeWaterAnswer, validateAddress, validateHomeYear, parseHomeYear, hasLocation, isProfileComplete } from '@/lib/frontend/onboarding';
import { clearOnboardingStorage, hasCompletedOnboarding, markCompleted } from '@/lib/frontend/storage';
import { householdKeys, type OnboardingApi, type Household, type OnboardResponse, type ErrorCode } from '@/lib/frontend/types';

const liveApi = createLiveOnboardingApi();
type Props = { api?: OnboardingApi; preview?: boolean; stackedWelcomeSubtitle?: boolean; entry?: boolean; changeAddress?: boolean; onComplete?: () => void };
type Errors = { address?: string; year?: string; water?: string; location?: string };

export default function OnboardingScreen({ api = liveApi, preview = false, stackedWelcomeSubtitle = false, entry = false, changeAddress = false, onComplete }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [session, setSession] = useState<'loading' | 'ready' | 'error'>('loading');
  const [address, setAddress] = useState('');
  const [coordinates, setCoordinates] = useState<string | null>(null);
  const [household, setHousehold] = useState<Household>(emptyHousehold);
  const [year, setYear] = useState('');
  const [water, setWater] = useState('');
  const [location, setLocation] = useState<OnboardResponse | null>(null);
  const [refreshReadings, setRefreshReadings] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [offline, setOffline] = useState(false);
  const mounted = useRef(false);
  const flowId = useRef('');
  const stepRef = useRef(0);
  const furthest = useRef(0);
  const historyIndex = useRef(0);
  const bootstrapId = useRef(0);
  const bootstrapRequest = useRef<AbortController | null>(null);
  const request = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const locked = useRef(false);
  const gpsRequest = useRef(0);
  const container = useRef<HTMLElement>(null);
  const hadLocation = useRef(false);

  const finish = useCallback(() => {
    if (onComplete) onComplete(); else router.replace('/today');
  }, [onComplete, router]);

  const cancel = useCallback(() => {
    requestId.current++;
    request.current?.abort(); request.current = null;
    gpsRequest.current++;
    locked.current = false;
    setBusy(false); setLocating(false);
  }, []);

  const move = useCallback((next: number, replace = false) => {
    cancel();
    setErrors({}); setFailure(null);
    stepRef.current = next;
    furthest.current = Math.max(furthest.current, next);
    if (!replace) historyIndex.current++;
    window.history[replace ? 'replaceState' : 'pushState'](
      {...window.history.state, haloOnboarding: {id: flowId.current, step: next, index: historyIndex.current}}, '', window.location.href,
    );
    setStep(next);
  }, [cancel]);

  const bootstrap = useCallback(async () => {
    const id = ++bootstrapId.current;
    bootstrapRequest.current?.abort();
    const controller = new AbortController();
    bootstrapRequest.current = controller;
    const current = () => mounted.current && id === bootstrapId.current && !controller.signal.aborted;
    setSession('loading'); setFailure(null);
    try {
      await api.ensureSession();
      if (!current()) return;
      try {
        const profile = await api.getProfile(controller.signal);
        if (!current()) return;
        hadLocation.current = hasLocation(profile.profile);
        if (!preview && !isProfileComplete(profile)) clearOnboardingStorage();
        if (!preview && entry && isProfileComplete(profile)) { finish(); return; }
        setHousehold(normalizeHousehold(profile.household));
        setYear(profile.profile?.home_year == null ? '' : String(profile.profile.home_year));
        setWater(normalizeWaterAnswer(profile.profile?.water_source ?? '') ?? '');
        if (changeAddress || (profile.onboarded === true && !isProfileComplete(profile))) move(1, true);
      } catch (error) {
        if (!current()) return;
        if (!preview && entry && hasCompletedOnboarding()) { router.replace('/today?verify=1'); return; }
        if (errorCode(error) === 'session_changed') clearOnboardingStorage();
        // A failed profile lookup is not an empty household finding. With no
        // completion flag, the specification sends the person to onboarding.
      }
      if (current()) setSession('ready');
    } catch (error) {
      if (!current()) return;
      setSession('error'); setFailure(errorCode(error));
    }
  }, [api, changeAddress, entry, finish, move, preview, router]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    flowId.current = crypto.randomUUID();
    historyIndex.current = 0;
    window.history.replaceState({...window.history.state, haloOnboarding:{id:flowId.current,step:0,index:0}}, '', window.location.href);
    queueMicrotask(() => { if (active) void bootstrap(); });
    const pop = (event: PopStateEvent) => {
      const saved = event.state?.haloOnboarding;
      if (saved?.id !== flowId.current) return;
      cancel(); setErrors({}); setFailure(null);
      const next = Math.min(furthest.current, Math.max(0, Number(saved.step) || 0));
      historyIndex.current = Math.max(0, Number(saved.index) || 0);
      stepRef.current = next; setStep(next);
    };
    const connection = () => setOffline(!navigator.onLine);
    const identityChanged = () => {
      // Initial session establishment has no draft or results to discard.
      if (stepRef.current === 0) return;
      clearOnboardingStorage();
      setAddress(''); setCoordinates(null); setHousehold(emptyHousehold());
      setYear(''); setWater(''); setLocation(null);
      hadLocation.current = false; setRefreshReadings(false);
      move(1, true); setFailure('session_changed');
    };
    queueMicrotask(() => { if (active) connection(); });
    window.addEventListener('popstate', pop);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    if (!preview) window.addEventListener('halo:identity-changed', identityChanged);
    return () => {
      active = false; mounted.current = false;
      bootstrapRequest.current?.abort(); request.current?.abort();
      window.removeEventListener('popstate', pop);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      window.removeEventListener('halo:identity-changed', identityChanged);
    };
  }, [bootstrap, cancel, move, preview]);

  useEffect(() => {
    const heading = container.current?.querySelector<HTMLElement>('h1');
    if (step !== 0 && heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); }
    if (step !== 0) window.scrollTo({top:0,behavior:'instant'});
  }, [step]);

  const recoverLocation = useCallback((code: ErrorCode) => {
    clearOnboardingStorage(); move(1, true); setFailure(code);
  }, [move]);

  function back() {
    if (step <= 0) return;
    cancel();
    if (window.history.state?.haloOnboarding?.id === flowId.current && historyIndex.current > 0) window.history.back();
    else move(step - 1, true);
  }

  async function submit() {
    if (locked.current || locating || session !== 'ready') return;
    if (step === 0) { move(1); return; }
    if (step === 4) return;
    if (step === 1) {
      const message = coordinates ? '' : validateAddress(address);
      setErrors(previous => ({...previous,address:message}));
      if (message) { container.current?.querySelector<HTMLInputElement>('#halo-address')?.focus(); return; }
    }
    if (step === 3) {
      const yearError = validateHomeYear(year), waterError = normalizeWaterAnswer(water) ? '' : copy.home.waterRequired;
      setErrors({year:yearError,water:waterError});
      if (yearError || waterError) {container.current?.querySelector<HTMLElement>(yearError ? '#halo-year' : '#halo-water')?.focus(); return;}
    }
    locked.current=true; setBusy(true); setFailure(null);
    const controller = new AbortController(); request.current = controller;
    const id = ++requestId.current;
    const current = () => mounted.current && id === requestId.current && !controller.signal.aborted;
    try {
      if (step === 1) {
        const result = await api.submitAddress(coordinates ?? address,controller.signal);
        if (!current()) return;
        setRefreshReadings(hadLocation.current);
        hadLocation.current = true;
        setLocation(result); move(2);
      } else if (step === 2) {
        await api.saveHousehold({...household},controller.signal);
        if (current()) move(3);
      } else if (step === 3) {
        const profile = await api.saveHome({water_source:water,home_year:parseHomeYear(year)},controller.signal);
        if (!current()) return;
        if (!isProfileComplete(profile)) throw new FrontendError('no_location');
        if (!preview) markCompleted(profile);
        setLocation(previous => ({...previous,...profile.profile}));
        move(4);
      }
    } catch (error) {
      if (!current()) return;
      const code = errorCode(error);
      if (code === 'aborted') return;
      if (code === 'session_changed' || code === 'no_location') {move(1,true); setFailure(code);}
      else if (code === 'address_not_found' || code === 'address_required') setErrors(previous => ({...previous,address:copy.errors[code]}));
      else setFailure(code);
    } finally { if (current()) {locked.current=false; setBusy(false); request.current=null;} }
  }

  function locate() {
    if (busy || locating) return;
    if (!navigator.geolocation) {setErrors(previous => ({...previous,location:copy.address.unsupported})); return;}
    const id = ++gpsRequest.current;
    setLocating(true); setErrors(previous => ({...previous,location:''}));
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current || id !== gpsRequest.current || stepRef.current !== 1) return;
      const {longitude,latitude} = position.coords;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {setLocating(false); setErrors(previous => ({...previous,location:copy.address.denied})); return;}
      setCoordinates(`${longitude},${latitude}`); setAddress(copy.address.currentLocation);
      setErrors(previous => ({...previous,address:'',location:''})); setLocating(false);
    }, () => {
      if (!mounted.current || id !== gpsRequest.current) return;
      setLocating(false); setErrors(previous => ({...previous,location:copy.address.denied}));
    }, {timeout:10000,maximumAge:0,enableHighAccuracy:false});
  }

  const nav = <div className="halo-top"><div className="halo-progress" role="img" aria-label={copy.common.progress(step+1)}>{[0,1,2,3].map(i=><span key={i} data-filled={i<=step} />)}</div><button type="button" className="halo-back" aria-label={copy.common.back} onClick={back}><ArrowLeft size={22} aria-hidden="true" /></button></div>;
  const errorBox = failure && <ErrorCallout message={copy.errors[failure]} retry={failure === 'rate_limited' ? undefined : () => {if (session === 'error') void bootstrap(); else void submit();}} />;

  return <main ref={container} className={`halo-app${preview ? ' halo-preview' : ''}`} data-step={step}>
    <form className="halo-page" noValidate aria-label={[copy.welcome.title,copy.address.title,copy.household.title,copy.home.title,copy.reveal.title][step]} onSubmit={event => {event.preventDefault(); void submit();}}>
      {offline && <div className="halo-offline" role="status"><WifiOff size={18} aria-hidden="true" />{copy.common.offline}</div>}
      {step === 0 && <><div className="halo-band"><div className="halo-logo halo-logo-tile"><Image src="/halo-logo-mark.png" alt="" width={158} height={158} priority unoptimized /></div></div><div className="halo-welcome-copy"><WelcomeTitle stackedSubtitle={stackedWelcomeSubtitle} /><p>{copy.welcome.description}</p><p className="halo-account-note">{copy.welcome.account}</p></div><div className="halo-footer">{errorBox}<Button type="submit" busy={session==='loading'} disabled={session==='error'}>{copy.welcome.start}</Button><p className="halo-footer-note">{copy.welcome.duration}</p></div></>}
      {step === 1 && <>{nav}<div className="halo-main"><h1>{copy.address.title}</h1><div className="halo-fields"><div className="halo-field"><label className="halo-label" htmlFor="halo-address">{copy.address.label}</label><input id="halo-address" className="halo-input" type="text" autoComplete="street-address" placeholder={copy.address.placeholder} value={address} disabled={busy} aria-invalid={!!errors.address} aria-describedby="halo-address-error halo-privacy" onChange={event=>{gpsRequest.current++;setLocating(false);setCoordinates(null);setAddress(event.target.value);if(!validateAddress(event.target.value))setErrors(previous=>({...previous,address:''}));}} onBlur={()=>setErrors(previous=>({...previous,address:coordinates?'':validateAddress(address)}))} /><FieldError id="halo-address-error" message={errors.address} /><p className="halo-privacy" id="halo-privacy">{copy.address.privacy}</p></div></div><div className="halo-location"><Button variant="secondary" onClick={locate} busy={locating} disabled={busy}>{copy.address.useLocation}</Button><div className="halo-location-note"><FieldError id="halo-location-error" message={errors.location} /></div></div></div><div className="halo-footer">{errorBox}<Button type="submit" busy={busy} disabled={locating || session!=='ready'}>{copy.common.continue}</Button>{busy && <p className="halo-footer-note" role="status">{copy.address.finding}</p>}</div></>}
      {step === 2 && <>{nav}<div className="halo-main"><h1>{copy.household.title}</h1><p className="halo-intro">{copy.household.description}</p><fieldset className="halo-chips"><legend className="halo-sr">{copy.household.legend}</legend>{householdKeys.map(key=><button type="button" className="halo-chip" key={key} aria-pressed={household[key]} disabled={busy} onClick={()=>setHousehold(previous=>({...previous,[key]:!previous[key]}))}><span className="halo-chip-mark">{household[key]?<Check size={17} aria-hidden="true" />:<Plus size={17} aria-hidden="true" />}</span><span>{copy.household.groups[key]}</span></button>)}</fieldset></div><div className="halo-footer">{errorBox}<div className="halo-actions-equal"><Button variant="secondary" disabled={busy} onClick={()=>move(3)}>{copy.household.skip}</Button><Button type="submit" variant="secondary" busy={busy}>{copy.common.continue}</Button></div></div></>}
      {step === 3 && <>{nav}<div className="halo-main"><h1>{copy.home.title}</h1><div className="halo-fields"><div className="halo-field"><label className="halo-label" htmlFor="halo-year"><span>{copy.home.year}</span><span className="halo-optional">{copy.common.optional}</span></label><input id="halo-year" className="halo-input" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={year} disabled={busy} aria-invalid={!!errors.year} aria-describedby="halo-year-error halo-year-help" onChange={event=>{const next=event.target.value.replace(/\D/g,'').slice(0,4);setYear(next);if(!validateHomeYear(next))setErrors(previous=>({...previous,year:''}));}} onBlur={()=>setErrors(previous=>({...previous,year:validateHomeYear(year)}))} /><FieldError id="halo-year-error" message={errors.year} /><p className="halo-year-help" id="halo-year-help">{copy.home.yearHelp}</p></div><div className="halo-field"><label className="halo-label" htmlFor="halo-water">{copy.home.water}</label><select id="halo-water" className="halo-select" value={water} disabled={busy} aria-invalid={!!errors.water} aria-describedby="halo-water-error" onChange={event=>{setWater(event.target.value);if(event.target.value)setErrors(previous=>({...previous,water:''}));}} onBlur={()=>setErrors(previous=>({...previous,water:water?'':copy.home.waterRequired}))}><option value="">{copy.home.waterPlaceholder}</option>{copy.home.waterOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldError id="halo-water-error" message={errors.water} /></div></div></div><div className="halo-footer">{errorBox}<Button type="submit" busy={busy}>{copy.home.results}</Button></div></>}
      {step === 4 && <ResultsReveal api={api} location={location} fresh={refreshReadings} onComplete={finish} onInvalidLocation={recoverLocation} />}
    </form>
  </main>;
}
