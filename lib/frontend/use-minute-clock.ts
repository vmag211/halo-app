'use client';
import { useSyncExternalStore } from 'react';

const readMinute = () => Math.floor(Date.now() / 60000) * 60000;
const serverMinute = () => null;
function subscribeMinute(notify: () => void) {
  const tick = setInterval(notify, 15000);
  document.addEventListener('visibilitychange', notify);
  return () => { clearInterval(tick); document.removeEventListener('visibilitychange', notify); };
}

/**
 * The device clock, rounded to the minute. It is null during server rendering and hydration,
 * so date-dependent screens never bake the server's (or a static build's) day into the page,
 * and it advances past midnight while the screen stays open.
 */
export function useMinuteClock(): number | null {
  return useSyncExternalStore<number | null>(subscribeMinute, readMinute, serverMinute);
}
