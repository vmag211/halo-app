/**
 * Journal (My Week) on the screen: the honest "not available yet" against a
 * real transient failure, at every entry point, and the Journal page's own
 * identity (browser title, app header, current navigation entry).
 *
 * The provider's load decision is the compiled client (runtime and adapter)
 * plus test/helpers/frontendB11.mjs, which transcribes HomeWorkspaceState.tsx
 * (a drift test below pins the line). The shell's wiring is checked in the
 * source, as the other shell sweeps do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { homeWorkspace } from './helpers/frontendB11.mjs';

const { collectionView, journalOffMessage } = await loadFrontend('collection-availability');
const { destinationTitle, destinationHeader, isJournalDestination, journalDestinations, productRoute, productDestinationHref } = await loadFrontend('product-routes');
const { createProductionRuntime } = await loadFrontend('production/runtime');
const { createHomeAdapter } = await loadFrontend('production/adapters');

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const HOME = '0b110000-0000-4000-8000-0000000000aa';

/** The provider over the client's own runtime and adapter, answering one load with `answer`. */
async function loadedWith(answer) {
  const fetcher = async (target) => {
    const url = new URL(target, 'http://halo.test');
    if (url.pathname === '/api/frontend/workspace') return answer();
    throw new Error(`unexpected ${target}`);
  };
  const runtime = createProductionRuntime({ identityId: 'u', homeContextId: HOME, contextRevision: 1, credential: async () => ({ identityId: 'u', accessToken: 't' }), fetcher });
  const ws = homeWorkspace(createHomeAdapter(runtime, { currentHomeId: HOME, homes: [{ id: HOME, label: 'Home', state: 'current', revision: 1 }] }));
  await ws.loadCollection('weekJournal');
  return ws;
}
const json = (status, body) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('the server saying "unavailable" (journal not stored, or its flag off) is a settled "not available yet": no retry', async () => {
  const ws = await loadedWith(json(200, { records: [], availability: 'unavailable', complete: false, message: 'Week journal check-ins are not stored on the server yet.', pendingOperations: [] }));
  assert.equal(ws.status('weekJournal').featureUnavailable, true);
  assert.equal(collectionView(ws.status('weekJournal')), 'off');
  assert.match(journalOffMessage, /not available yet/);
  assert.doesNotMatch(journalOffMessage, /—/);
});

test('a real transient failure (a 5xx, a dropped connection, an unreadable answer) keeps the error and its Try again', async () => {
  for (const answer of [
    json(500, { error: 'x', code: 'internal_error', message: 'x', retryable: true }),
    json(503, { error: 'x', code: 'upstream_unavailable', message: 'x', retryable: true }),
    () => { throw new TypeError('Failed to fetch'); },
    json(200, { records: 'nope', availability: 'ready', complete: true, pendingOperations: [] }),
  ]) {
    const ws = await loadedWith(answer);
    assert.equal(collectionView(ws.status('weekJournal')), 'error');
  }
});

test('saved check-ins load ready, so Journal, Patterns and Season show them', async () => {
  const row = { id: 'journal:h:2026-10-20:household', title: 'Check-in', revision: 1, date: '2026-10-20', band: 'household', fine: true, symptoms: [], severity: '', illness: false, note: '', recalled: false, homeContextId: HOME };
  const ws = await loadedWith(json(200, { records: [row], availability: 'ready', complete: true, pendingOperations: [] }));
  assert.equal(collectionView(ws.status('weekJournal')), 'ready');
  assert.deepEqual(ws.records.weekJournal, [row]);
});

test('drift: the provider marks an "unavailable" answer settled, and the Journal page offers Try again only for a real failure', () => {
  const provider = source('components/homeguard/HomeWorkspaceState.tsx');
  assert.ok(provider.includes("if (snapshot.availability === 'unavailable') throw Object.assign(new Error(snapshot.message || 'This collection is unavailable. Your saved records are unchanged.'), { reason: 'feature_unavailable' });"));
  const journal = source('components/expanded/WeekJournal.tsx');
  assert.ok(journal.includes("{view==='off'?journalOffMessage:'Check-ins could not load. Editing is unavailable until records return.'}"));
  assert.ok(journal.includes("{view!=='off'&&<button"), 'no Try again when the journal is not available');
  // Every entry point renders this one page: the sidebar, My Week's tool and its links, alerts, Luna and deep links.
  const week = source('components/expanded/MyWeekWorkspace.tsx');
  assert.ok(week.includes("if(destination==='journal'||destination==='patterns'||destination==='recap')return <WeekJournal href={href} initialView={destination}/>;"));
  assert.ok(source('components/expanded/ExpandedConnections.tsx').includes("if (['journal','patterns','recap','outdoors','reminders'].includes(destination)) return <MyWeekWorkspace"));
});

test('the Journal page has its own name: browser title, app header and the current sidebar entry', () => {
  assert.deepEqual([...journalDestinations], ['journal', 'patterns', 'recap']);
  for (const destination of journalDestinations) {
    assert.equal(isJournalDestination(destination), true);
    assert.equal(destinationHeader(destination), 'Journal', destination);
  }
  for (const destination of ['tests', 'projects', 'outdoors', null, undefined, '']) assert.equal(destinationHeader(destination), null, String(destination));
  // Browser titles are the words the screen uses (Season, not the key "recap").
  assert.equal(destinationTitle('journal'), 'Journal');
  assert.equal(destinationTitle('patterns'), 'Patterns');
  assert.equal(destinationTitle('recap'), 'Season');
  assert.equal(destinationTitle('tests'), 'Tests');
  assert.equal(destinationTitle('opportunities'), 'Get involved');
  assert.equal(destinationTitle('observations'), 'Notes');
  // Deep links resolve to the journal destinations.
  assert.equal(productRoute('/app/journal')?.destination, 'journal');
  assert.equal(productRoute('/app/plan/patterns')?.destination, 'patterns');
  assert.equal(productRoute('/app/plan/recap')?.destination, 'recap');
  assert.equal(productDestinationHref('plan', 'journal'), '/app/journal?view=main');

  const page = source('app/(halo)/app/[[...screen]]/page.tsx');
  assert.ok(page.includes('title:route?.destination?destinationTitle(route.destination)'), 'metadata uses the shared title');
  const shell = source('components/foundation/FoundationPreview.tsx');
  assert.ok(shell.includes('const pageHeader = (!inDetail && destinationHeader(destination)) || routeTitles[route];'));
  assert.ok(shell.includes(': initialFactor ? factorReadings[initialFactor].title : pageHeader}</h1>'), 'the header says Journal');
  assert.ok(shell.includes('<AppSidebar active={journalCurrent ? null : activeTab} journalCurrent={journalCurrent}'), 'the sidebar marks Journal, not My Week');
  const sidebar = source('components/ui/AppSidebar.tsx');
  assert.ok(sidebar.includes("<Link href={journalHref} title={collapsed?'Journal':undefined} aria-current={journalCurrent?'page':undefined}>"));
  for (const text of [page, sidebar]) assert.doesNotMatch(text, /—/);
});
