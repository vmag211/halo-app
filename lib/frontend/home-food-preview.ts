/** Isolated review fixtures. No values in this module describe a real place or product. */
export type FoodRecord = { id: string; title: string; revision: number };
export type GardenSite = FoodRecord & {
  setup: string; county: string; irrigation: string; householdSourceConfirmed: boolean;
  soil: string; concern: string; questions: string; testIds: string[];
  history: { date: string; irrigation: string; soil: string; revision: number }[];
};
export type FishNote = FoodRecord & {
  kind: 'catch' | 'consumption'; date: string; timezone: string; waterbody: string; species: string;
  quantity: string; unit: string; note: string; advisoryId: string; advisoryRevision: number;
  history?: { date: string; revision: number; original: Omit<FishNote, 'history'> }[];
};
export type FoodFollow = FoodRecord & { kind: 'fish' | 'food' | 'water' | 'resource'; targetId: string; sourceRevision: number; following: boolean; saved: boolean };
export type EvidenceQuestion = FoodRecord & { evidenceId: string; question: string; reportId: string; note: string };
export type GrowerInquiry = FoodRecord & {
  resourceId: string; siteId: string; testId: string; checklist: string[]; questions: string;
  state: string; contactDate: string; followUpDate: string; reference: string; response: string;
};
export type UsageRecord = FoodRecord & {
  kind: 'interval' | 'meter'; site: string; meter: string; start: string; end: string;
  quantity: string; unit: string; basis: 'measured' | 'estimated' | 'user-reported'; source: string;
  reset: boolean; note: string; history: { date: string; quantity: string; unit: string; start: string; end: string; reason: string; original?: Omit<UsageRecord, 'history'> }[];
};
export const foodSources = {
  fish: 'https://epi.dph.ncdhhs.gov/oee/fish/arcg.html',
  food: 'https://www.fda.gov/food/process-contaminants-food/testing-food-pfas-and-assessing-dietary-exposure',
  recalls: 'https://open.fda.gov/apis/food/enforcement/',
  extension: 'https://www.ces.ncsu.edu/local-county-center/',
  soil: 'https://www.ncagr.gov/Divisions/Agronomic-Services/soil-testing',
  labs: 'https://www.deq.nc.gov/about/divisions/water-resources/drinking-water/drinking-water-laboratories',
  nrcs: 'https://www.nrcs.usda.gov/programs-initiatives/eqip-environmental-quality-incentives/cpas-dias-and-cemas',
  drought: 'https://droughtmonitor.unl.edu/DmData/DataDownload/WebServiceInfo.aspx',
  utility: 'https://www.ncwater.org/WUDC/conservation-status',
};
export const fishWaterbodies = [
  { id: 'demo-willow-lake', title: 'Willow Lake', extent: 'Synthetic lake, Example County. North basin only.', jurisdiction: 'Example County, NC (fictional)' },
  { id: 'demo-willow-river', title: 'Willow River', extent: 'Synthetic river, Example County. Bridge A to Bridge B.', jurisdiction: 'Example County, NC (fictional)' },
  { id: 'demo-uncovered', title: 'Willow Lake', extent: 'Synthetic lake, Other County. No reviewed record in this fixture.', jurisdiction: 'Other County, NC (fictional)' },
] as const;
export const fishAudiences = [
  { id: 'unknown', title: 'I am not sure which source category applies' },
  { id: 'demo-general', title: 'Adults 18 and older, outside category B (synthetic category A)' },
  { id: 'demo-sensitive', title: 'People who are pregnant or may become pregnant; children under 18 (synthetic category B)' },
] as const;
export const fishRules = [
  { id: 'demo-local-fish', title: 'Willow Lake, north basin', kind: 'Waterbody-specific', waterbody: 'demo-willow-lake', species: 'Largemouth bass', revision: 2, status: 'Current in fixture', date: '2026-09-24', extent: 'North basin of fictional Willow Lake. Does not cover Willow River or the lake in Other County.', pollutant: 'Synthetic contaminant context', wording: 'Training example only. Category A: no more than one 4 oz serving per calendar month. Category B: do not eat the listed fish.', condition: 'The example limit applies to the listed species combined. Separate source rules must be reviewed together; allowances cannot be added.', previous: 'Revision 1 used a different northern boundary. It was superseded on September 24, 2026.' },
  { id: 'demo-state-fish', title: 'Statewide species reference', kind: 'Statewide', waterbody: 'statewide', species: 'Largemouth bass', revision: 3, status: 'Current in fixture', date: '2026-09-17', extent: 'Fictional statewide extent. Displayed beside the waterbody-specific record, never merged into a new meal limit.', pollutant: 'Synthetic contaminant context', wording: 'Training example only. Category A: no more than one 4 oz serving per calendar week. Category B: do not eat the listed fish.', condition: 'This example serving definition is 4 oz. The source time window is a calendar week. Follow the complete applicable source rules together.', previous: 'Revision 2 was superseded on September 17, 2026. It remains an historical reference only.' },
  { id: 'demo-fish-conflict', title: 'Willow River, unresolved source text', kind: 'Waterbody-specific', waterbody: 'demo-willow-river', species: 'Catfish (unresolved group)', revision: 1, status: 'Review required', date: '2026-09-24', extent: 'Fictional Bridge A to Bridge B. A point or radius is not the official extent.', pollutant: 'Unresolved source', wording: 'Recommendation withheld. This synthetic example contains conflicting audience fields and truncated text.', condition: 'Open the complete official source and confirm species, audience and extent. HALO cannot resolve a recommendation from this fixture.', previous: 'No reviewed earlier version.' },
] as const;
export function matchFishRules(waterbody: string, species: string) {
  if (!fishWaterbodies.some(item => item.id === waterbody) || waterbody === 'demo-uncovered' || species === 'unknown') return [];
  return fishRules.filter(rule => rule.species === species && (rule.waterbody === waterbody || rule.waterbody === 'statewide'));
}
export const initialGardens: GardenSite[] = [{ id: 'demo-garden', title: 'Back garden', revision: 1, setup: 'Raised bed', county: 'Example County (synthetic)', irrigation: 'Unknown', householdSourceConfirmed: false, soil: 'Purchased soil, supplier record not yet added', concern: 'Understand which testing service fits my question', questions: 'Does a routine fertility panel answer my contaminant question?', testIds: [], history: [] }];
export const foodEvidence = [
  { id: 'demo-notice', title: 'Packaged-food notice reference', kind: 'Notice', region: 'Example County', category: 'Packaged food', status: 'Active in fixture', version: 2, issued: '2026-09-26', sampleDate: 'Not supplied', scope: 'Fictional product Example Pantry Mix, lot DEMO-042 only. Distribution: Example County in this fixture.', finding: 'Synthetic notice workflow. No chemical concentration is supplied by the notice.', applicability: 'A matching product and lot are both needed. A business address is not the distribution area.', instruction: 'Demonstration only: compare the product and lot with the complete issuing notice, then use its instructions. This fixture is not a consumer notice.', previous: 'Version 1 listed lot DEMO-041. Version 2 corrects the lot to DEMO-042. The older scope is superseded.', url: foodSources.recalls },
  { id: 'demo-terminated', title: 'Seafood notice reference', kind: 'Notice', region: 'National', category: 'Seafood', status: 'Terminated in fixture', version: 3, issued: '2025-04-12', sampleDate: 'Not supplied', scope: 'Fictional Example Clams, lot DEMO-018. Broad distribution described by the synthetic notice.', finding: 'Historical recall record. No laboratory values are represented here.', applicability: 'Terminated status is an event lifecycle, not a certificate that a product or category is safe.', instruction: 'This record is retained for history. Open the official source to inspect any real notice and its current instructions.', previous: 'Version 1 active; version 2 updated distribution; version 3 terminated on June 12, 2025.', url: foodSources.recalls },
  { id: 'demo-study', title: 'Food monitoring reference', kind: 'Study', region: 'National', category: 'Produce', status: 'Published example', version: 1, issued: '2026-08-20', sampleDate: '2026-05-10 through 2026-05-14 (synthetic)', scope: 'Three fictional produce samples. Farms, brands and individual households are not identified.', finding: 'PFAS, food tissue; original result not included in this interface fixture. No concentration or comparison is inferred.', applicability: 'A study sample represents that sample and its method. It does not identify the status of nearby farms or unsampled foods.', instruction: 'Read the study design and sample limitations. Prepare a source-specific question when applicability is unclear.', previous: 'Version 1. No superseded version in this fixture.', url: foodSources.food },
] as const;
export const growerResources = [
  { id: 'extension', title: 'Find a county Extension contact', concern: 'Questions and site context', region: 'North Carolina', matrix: 'Site questions and referral', scope: 'A contact-discovery pathway. Service availability and individual expertise require confirmation.', documents: ['Write the question you want answered', 'Describe the site and irrigation source if known', 'List any existing test report and its date'], qualifications: 'Confirm appointment availability and qualifications.', cost: 'Unknown. Ask the provider.', deadline: 'No deadline verified.', url: foodSources.extension },
  { id: 'soil', title: 'Routine soil fertility service', concern: 'Soil fertility', region: 'North Carolina', matrix: 'Soil, fertility service', scope: 'Routine fertility testing. This service is not a general contaminant screen or crop-safety certificate.', documents: ['Confirm that fertility is your testing purpose', 'Read the selected provider’s current sampling requirements', 'Record your site label and intended question'], qualifications: 'Contaminant analyte/method scope not established by a fertility listing.', cost: 'Current fee not verified.', deadline: 'Current seasonal timing not verified.', url: foodSources.soil },
  { id: 'lab', title: 'Drinking-water laboratory guidance', concern: 'Water testing', region: 'North Carolina', matrix: 'Drinking water; exact analyte and method to confirm', scope: 'A laboratory directory is a starting point. Certification must cover the specific matrix, analyte and method.', documents: ['Name the water source and the requested analyte', 'Ask the laboratory to confirm method and certification scope', 'Obtain the laboratory’s containers, handling and delivery instructions'], qualifications: 'No selected laboratory or certification has been verified.', cost: 'Quote needed from the selected laboratory.', deadline: 'Ask about hold time and delivery before collecting.', url: foodSources.labs },
  { id: 'nrcs', title: 'Conservation assessment pathways', concern: 'Conservation support', region: 'National', matrix: 'CEMA 207 and 209 activity directory', scope: 'Possible assessment pathways. Local funding, eligibility and availability are not established.', documents: ['Read the current official activity requirements', 'Ask whether the activity is available in your region', 'Prepare relevant source records for a conversation'], qualifications: 'No eligibility, funding, application receipt or approval determined.', cost: 'Assistance and participant costs not verified.', deadline: 'Current local deadline not verified.', url: foodSources.nrcs },
] as const;
export const droughtReleases = [
  { date: '2026-09-24', none: 40, d0: 35, d1: 25, d2: 0, d3: 0, d4: 0 },
  { date: '2026-10-01', none: 50, d0: 30, d1: 20, d2: 0, d3: 0, d4: 0 },
] as const;
export const initialUsage: UsageRecord[] = [
  { id: 'demo-use-1', title: 'August water bill', revision: 1, kind: 'interval', site: 'Example home', meter: 'Example meter A', start: '2026-08-01', end: '2026-08-31', quantity: '2700', unit: 'US gal', basis: 'measured', source: 'Synthetic bill', reset: false, note: '', history: [] },
  { id: 'demo-use-2', title: 'September water bill', revision: 1, kind: 'interval', site: 'Example home', meter: 'Example meter A', start: '2026-09-01', end: '2026-10-01', quantity: '2500', unit: 'US gal', basis: 'measured', source: 'Synthetic bill', reset: false, note: '', history: [] },
];
export function validFoodDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function periodDays(start: string, end: string): number {
  if (!validFoodDate(start) || !validFoodDate(end)) return 0;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}
export function validateUsage(record: UsageRecord): string | null {
  if (!record.title.trim() || !record.site.trim() || !record.meter.trim() || !record.source.trim()) return 'Add a label, site, meter or account label, and source.';
  if (!record.quantity.trim() || !Number.isFinite(Number(record.quantity)) || Number(record.quantity) < 0) return 'Enter a nonnegative original quantity.';
  if (!record.unit.trim()) return 'Keep the original unit.';
  if (!validFoodDate(record.end)) return 'Add a valid observation or period end date.';
  if (record.kind === 'interval' && periodDays(record.start, record.end) <= 0) return 'The usage period must end after it starts.';
  return null;
}
export type UsageComparison = { compatible: false; reason: string } | { compatible: true; kind: 'interval' | 'meter'; difference: number; unit: string; days: number; gapDays: number; description: string };
export function compareUsage(a: UsageRecord, b: UsageRecord): UsageComparison {
  const blocked = (reason: string): UsageComparison => ({ compatible: false, reason });
  if (a.id === b.id) return blocked('Choose two different records.');
  if (validateUsage(a) || validateUsage(b)) return blocked('Correct the missing or invalid entry fields before comparing.');
  if (a.kind !== b.kind) return blocked('An interval total cannot be compared with a cumulative meter reading.');
  if (a.site.trim() !== b.site.trim() || a.meter.trim() !== b.meter.trim()) return blocked('The site and meter or account must match.');
  if (a.unit !== b.unit) return blocked('Original units differ. Compare records with the same units.');
  if (a.basis !== 'measured' || b.basis !== 'measured') return blocked('Only measured entries can produce a measured comparison. Estimated and user-reported entries remain in history.');
  if (a.reset || b.reset) return blocked('A meter reset or replacement blocks automatic subtraction.');
  if (a.source.trim() !== b.source.trim()) return blocked('The measurement sources differ. Confirm a compatible method before comparing.');
  const [earlier, later] = a.end <= b.end ? [a, b] : [b, a];
  if (a.kind === 'meter') {
    const days = periodDays(earlier.end, later.end);
    if (days <= 0) return blocked('Cumulative readings need distinct observation dates.');
    const difference = Number(later.quantity) - Number(earlier.quantity);
    if (difference < 0) return blocked('The meter value decreased. Correct the record or flag a reset or replacement.');
    return { compatible: true, kind: 'meter', difference, unit: a.unit, days, gapDays: 0, description: 'Measured use between two cumulative readings. This is not a change between two usage periods.' };
  }
  const days = periodDays(earlier.start, earlier.end);
  if (periodDays(later.start, later.end) !== days) return blocked('The intervals have different lengths. Compare equal-length measured periods.');
  if (later.start < earlier.end) return blocked('The measured periods overlap.');
  return { compatible: true, kind: 'interval', difference: Number(later.quantity) - Number(earlier.quantity), unit: a.unit, days, gapDays: periodDays(earlier.end, later.start), description: 'Measured usage difference only. Weather, occupancy and other conditions may differ; this is not savings attributed to HALO.' };
}
export function downloadFoodRecord(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify({ notice: 'Private HALO export. User-entered records and source references are not verification of environmental safety.', exportedAt: new Date().toISOString(), record: value }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function foodId(prefix: string) { return `${prefix}-${globalThis.crypto.randomUUID()}`; }
export const sampleGardens = initialGardens;
export const sampleUsage = initialUsage;
export const sampleFishNotes: FishNote[] = [];
export const sampleGrowerInquiries: GrowerInquiry[] = [];
