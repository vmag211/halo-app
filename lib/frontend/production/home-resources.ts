import type { FoodEvidenceBundle } from '../food-evidence';

export type FishWaterbody = { id: string; title: string; extent: string; jurisdiction: string };
export type FishAudience = { id: string; title: string };
export type FishRule = { id: string; title: string; kind: string; waterbody: string; waterbodyIds?: readonly string[]; species: string; revision: number; status: string; date: string; extent: string; pollutant: string; wording: string; condition: string; previous: string; url?: string };
export type FishCatalogue = { waterbodies: readonly FishWaterbody[]; audiences: readonly FishAudience[]; rules: readonly FishRule[]; species: readonly string[]; sourceUrl?: string };
export type FoodNotice = { id: string; title: string; kind: string; region: string; category: string; status: string; version: number; issued: string; sampleDate: string; scope: string; finding: string; applicability: string; instruction: string; previous: string; url: string };
export type GrowerResource = { id: string; title: string; concern: string; region: string; matrix: string; scope: string; documents: readonly string[]; qualifications: string; cost: string; deadline: string; url: string; revision?: number };
export type WaterStewardship = {
  counties: { id: string; title: string }[];
  releases: { id: string; countyId: string; date: string; revision: number; none: number; d0: number; d1: number; d2: number; d3: number; d4: number; status: string; sourceUrl: string; scope: string }[];
  notices: { id: string; title: string; revision: number; status: string; date: string; instructions: string; scope: string; sourceUrl: string }[];
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string');
const list = (value: unknown, predicate: (item: unknown) => boolean) => Array.isArray(value) && value.length <= 10000 && value.every(predicate);
const revision = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
export const safePublicUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};
export function validFishCatalogue(value: unknown): value is FishCatalogue {
  return object(value) && (value.sourceUrl === undefined || safePublicUrl(value.sourceUrl)) && list(value.waterbodies, row => object(row) && strings(row, ['id', 'title', 'extent', 'jurisdiction'])) && list(value.audiences, row => object(row) && strings(row, ['id', 'title'])) && list(value.species, item => typeof item === 'string') && list(value.rules, row => object(row) && strings(row, ['id', 'title', 'kind', 'waterbody', 'species', 'status', 'date', 'extent', 'pollutant', 'wording', 'condition', 'previous']) && revision(row.revision) && safePublicUrl(row.url) && (row.waterbody !== 'statewide' || list(row.waterbodyIds, id => typeof id === 'string' && (value.waterbodies as FishWaterbody[]).some(item => item.id === id))));
}
export function validFoodNotices(value: unknown): value is FoodNotice[] {
  return list(value, row => object(row) && strings(row, ['id', 'title', 'kind', 'region', 'category', 'status', 'issued', 'sampleDate', 'scope', 'finding', 'applicability', 'instruction', 'previous']) && ['Study', 'Notice'].includes(String(row.kind)) && revision(row.version) && safePublicUrl(row.url));
}
export function validGrowerResources(value: unknown): value is GrowerResource[] {
  return list(value, row => object(row) && strings(row, ['id', 'title', 'concern', 'region', 'matrix', 'scope', 'qualifications', 'cost', 'deadline']) && list(row.documents, item => typeof item === 'string') && safePublicUrl(row.url) && revision(row.revision));
}
export function validWaterStewardship(value: unknown): value is WaterStewardship {
  return object(value) && list(value.counties, row => object(row) && strings(row, ['id', 'title'])) && list(value.releases, row => object(row) && strings(row, ['id', 'countyId', 'date', 'status', 'scope']) && revision(row.revision) && safePublicUrl(row.sourceUrl) && ['none', 'd0', 'd1', 'd2', 'd3', 'd4'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && Number(row[key]) >= 0 && Number(row[key]) <= 100)) && list(value.notices, row => object(row) && strings(row, ['id', 'title', 'status', 'date', 'instructions', 'scope']) && revision(row.revision) && safePublicUrl(row.sourceUrl));
}
export function validPublishedFoodEvidence(value: unknown): value is FoodEvidenceBundle {
  return object(value) && strings(value, ['boundary', 'reviewedAt', 'revision']) && list(value.indicators, row => object(row) && ['PFAS', 'Lead'].includes(String(row.contaminant)) && row.itemLevel === 'Unknown' && strings(row, ['label'])) && list(value.studies, row => object(row) && strings(row, ['id', 'title', 'analyte', 'finding', 'scopeDetail', 'limitation', 'nextStep']) && row.scope === 'food-study' && ['PFAS', 'Lead'].includes(String(row.contaminant)) && object(row.source) && strings(row.source, ['title', 'locator', 'publishedAt', 'sampledAt', 'reviewedAt']) && safePublicUrl(row.source.url) && safePublicUrl(row.source.methodologyUrl) && object(row.sample) && strings(row.sample, ['region', 'method', 'basis']) && list(row.metrics, metric => object(metric) && strings(metric, ['label', 'value', 'unit'])));
}
