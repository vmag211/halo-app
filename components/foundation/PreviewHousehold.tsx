'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { defaultPreviewBands, homeMemberKeys, memberCatalog, type HouseholdBands, type HomeMemberKey } from '@/lib/frontend/home-household';

type HouseholdContextValue = { bands: HouseholdBands; setBand: (key: HomeMemberKey, selected: boolean) => void };
const HouseholdContext = createContext<HouseholdContextValue>({ bands: defaultPreviewBands, setBand: () => {} });

/** Review state only. Never reads live profiles or saves health categories in a URL or storage. */
export function PreviewHouseholdProvider({ children }: { children: ReactNode }) {
  const [bands, setBands] = useState<HouseholdBands>(defaultPreviewBands);
  function setBand(key: HomeMemberKey, selected: boolean) {
    setBands(current => ({ ...current, [memberCatalog[key].band]: selected }));
  }
  return <HouseholdContext.Provider value={{ bands, setBand }}>{children}</HouseholdContext.Provider>;
}

export const usePreviewHousehold = () => useContext(HouseholdContext);

/** Production supplies only categories returned by the authenticated profile. */
export function HouseholdProvider({ bands, children }: { bands: HouseholdBands; children: ReactNode }) {
  return <HouseholdContext.Provider value={{ bands, setBand: () => {} }}>{children}</HouseholdContext.Provider>;
}

export function PreviewHouseholdPicker() {
  const { bands, setBand } = usePreviewHousehold();
  return <fieldset className="halo-household-picker"><legend>Homeguard sample household</legend><p>Choose the categories shown inside the house. Review choices stay in memory and reset on reload. They do not change your real profile.</p><div>{homeMemberKeys.map(key => <label key={key}><input type="checkbox" checked={bands[memberCatalog[key].band]} onChange={event => setBand(key, event.target.checked)} />{memberCatalog[key].label}</label>)}</div></fieldset>;
}
