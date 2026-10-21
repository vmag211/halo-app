import { catalogueFood, foodCatalogue } from './food-catalogue';

/** Reviewed public evidence only. This module cannot determine a household item's chemistry. */
export const foodEvidenceReviewedAt = '2026-10-03';
export const foodEvidenceRevision = 'food-evidence-2026-10-03-1';
export type FoodContaminant = 'PFAS' | 'Lead';
export type FoodEvidenceMetric = Readonly<{ label: string; value: string; unit: string; qualifier: 'count' | 'detected-range' | 'maximum' | 'not-detected' | 'reporting-limit' }>;
export type FoodEvidenceRecord = Readonly<{
  id: string; title: string; contaminant: FoodContaminant; analyte: string;
  foodIds: readonly string[]; scope: 'food-study'; finding: string;
  metrics: readonly FoodEvidenceMetric[];
  source: Readonly<{ title: string; url: string; locator: string; publishedAt: string; sampledAt: string; reviewedAt: string; methodologyUrl: string }>;
  scopeDetail: string; limitation: string; nextStep: string;
  sample: Readonly<{ count: number; detects: number; nonDetects: number; description: string; region: string; method: string; basis: string; limit: number; limitKind: 'MDL' | 'reporting-limit'; unit: string }>;
}>;

const seafoodSource = {
  title: 'FDA 2022 seafood survey', url: 'https://www.fda.gov/media/159570/download',
  publishedAt: 'July 2022', sampledAt: '2021-2022', reviewedAt: foodEvidenceReviewedAt,
  methodologyUrl: 'https://www.fda.gov/food/process-contaminants-food/testing-food-pfas-and-assessing-dietary-exposure',
};
const tdsSource = {
  title: 'FDA Total Diet Study, FY2018-FY2020', url: 'https://www.fda.gov/media/159751/download',
  publishedAt: 'July 2022', sampledAt: 'Fiscal years 2018-2020', reviewedAt: foodEvidenceReviewedAt,
  methodologyUrl: 'https://www.fda.gov/media/159745/download',
};
const studyBoundary = 'These are historical study samples, not a measurement or estimate of your food. They do not establish that a particular item is safe or unsafe.';

export const foodEvidenceRecords: readonly FoodEvidenceRecord[] = [
  {
    id: 'fda-seafood-2022-tuna-pfos', title: 'PFOS in sampled packaged tuna', contaminant: 'PFAS', analyte: 'PFOS', foodIds: ['tuna', 'canned-tuna'], scope: 'food-study',
    finding: 'Five of ten tuna samples had detectable PFOS, one PFAS compound. The detected results ranged from 50 to 195 ppt. Five were below the method detection limit.',
    metrics: [{ label: 'Detectable PFOS', value: '5 of 10', unit: 'samples', qualifier: 'count' }, { label: 'Detected range', value: '50 to 195', unit: 'ppt (ng/kg)', qualifier: 'detected-range' }],
    source: { ...seafoodSource, locator: 'PDF page 1, tuna 1-1 through 1-10, PFOS column' },
    scopeDetail: 'Retail packaged tuna, including light and albacore varieties. Sample origins were Ecuador, Thailand or not indicated. Counts and detected range are a HALO summary of the ten published rows.',
    limitation: `${studyBoundary} PFOS is not total PFAS. The five results marked <MDL were below 39 ng/kg, not proven zero.`,
    nextStep: 'For a product notice, compare the exact brand and lot. For self-caught fish, use the relevant waterbody and species advisory instead of a packaged-tuna study.',
    sample: { count: 10, detects: 5, nonDetects: 5, description: 'Packaged tuna, cans and one foil pouch', region: 'U.S. retail survey; multiple stated countries of origin', method: 'LC-MS/MS, Instrument 1', basis: 'Original food-mass units: ppt = ng/kg. Wet/dry basis is not separately stated in this table.', limit: 39, limitKind: 'MDL', unit: 'ng/kg' },
  },
  {
    id: 'fda-seafood-2022-salmon-pfdoa', title: 'PFDoA in sampled Atlantic salmon', contaminant: 'PFAS', analyte: 'PFDoA', foodIds: ['salmon'], scope: 'food-study',
    finding: 'Eight of ten Atlantic salmon samples had detectable PFDoA, one PFAS compound. Detected results ranged from 20 to 45 ppt. Two were below the method detection limit.',
    metrics: [{ label: 'Detectable PFDoA', value: '8 of 10', unit: 'samples', qualifier: 'count' }, { label: 'Detected range', value: '20 to 45', unit: 'ppt (ng/kg)', qualifier: 'detected-range' }],
    source: { ...seafoodSource, locator: 'PDF page 2, salmon 1-1 through 1-10, PFDoA column' },
    scopeDetail: 'Farmed Atlantic salmon bought at retail, with Chile, Norway and Canada listed as origins. Counts and detected range are a HALO summary of the ten published rows.',
    limitation: `${studyBoundary} PFDoA is not total PFAS. The two results marked <MDL were below 16 ng/kg, not proven zero. This does not describe wild salmon or a particular farm.`,
    nextStep: 'Keep the product origin if you know it. Use the source for its tested sample scope, not as a reason to remove a whole food group.',
    sample: { count: 10, detects: 8, nonDetects: 2, description: 'Farmed Atlantic salmon', region: 'U.S. retail survey; Chile, Norway and Canada listed as origins', method: 'LC-MS/MS, Instrument 1', basis: 'Original food-mass units: ppt = ng/kg. Wet/dry basis is not separately stated in this table.', limit: 16, limitKind: 'MDL', unit: 'ng/kg' },
  },
  {
    id: 'fda-tds-2018-2020-whole-milk-lead', title: 'Lead testing in whole milk', contaminant: 'Lead', analyte: 'Lead (Pb)', foodIds: ['milk'], scope: 'food-study',
    finding: 'All 27 whole-milk samples were reported as not detected for lead. The table gives a reporting limit of 1 ppb.',
    metrics: [{ label: 'Reported not detected', value: '27 of 27', unit: 'samples', qualifier: 'not-detected' }, { label: 'Reporting limit', value: '1', unit: 'ppb', qualifier: 'reporting-limit' }],
    source: { ...tdsSource, locator: 'Supplement PDF page 1, TDS food 1: Milk, whole, fluid; Lead, Pb' },
    scopeDetail: 'Historical U.S. Total Diet Study composite samples of fluid whole milk. This entry does not represent every type of milk, producer or carton.',
    limitation: `${studyBoundary} Not detected does not mean zero. A reporting limit is a laboratory reporting boundary, not a food safety limit.`,
    nextStep: 'If you have a question about a specific carton, keep the producer and lot details with that question. Do not transfer a whole-milk finding to infant formula or plant-based drinks.',
    sample: { count: 27, detects: 0, nonDetects: 27, description: 'Fluid whole milk, TDS food 1', region: 'U.S. Total Diet Study collections', method: 'EAM 4.7, ICP-MS; report Appendix B, Table 7', basis: 'Original food-mass units: ppb. No wet/dry conversion is applied.', limit: 1, limitKind: 'reporting-limit', unit: 'ppb' },
  },
  {
    id: 'fda-tds-2018-2020-spinach-lead', title: 'Lead testing in raw spinach', contaminant: 'Lead', analyte: 'Lead (Pb)', foodIds: ['spinach'], scope: 'food-study',
    finding: 'Lead was detected in 21 of 27 raw-spinach samples. Six were reported as not detected. The highest published result was 18 ppb.',
    metrics: [{ label: 'Detectable lead', value: '21 of 27', unit: 'samples', qualifier: 'count' }, { label: 'Highest sampled result', value: '18', unit: 'ppb', qualifier: 'maximum' }],
    source: { ...tdsSource, locator: 'Supplement PDF pages 55-56, TDS food 408: Spinach, raw; Lead, Pb' },
    scopeDetail: 'Historical U.S. Total Diet Study composite samples of raw spinach. The table reports a 4 ppb reporting limit. The maximum is not a prediction for your spinach.',
    limitation: `${studyBoundary} These samples cannot describe a local garden, bag or current harvest. Reporting limits are not food safety limits.`,
    nextStep: 'For homegrown spinach, keep growing-site and irrigation questions together in My garden. Soil or water results cannot substitute for a crop test.',
    sample: { count: 27, detects: 21, nonDetects: 6, description: 'Raw spinach, TDS food 408', region: 'U.S. Total Diet Study collections', method: 'EAM 4.7, ICP-MS; report Appendix B, Table 7', basis: 'Original food-mass units: ppb. No wet/dry conversion is applied.', limit: 4, limitKind: 'reporting-limit', unit: 'ppb' },
  },
];

export type FoodEvidenceQuery = { foodId?: string; name?: string; guideId?: string };
export type FoodEvidenceBundle = Readonly<{
  foodId?: string; studies: readonly FoodEvidenceRecord[];
  indicators: readonly Readonly<{ contaminant: FoodContaminant; label: 'Study available' | 'Guidance available'; itemLevel: 'Unknown'; evidenceCount: number }>[];
  boundary: string; reviewedAt: string; revision: string;
}>;

/** Strict catalogue identity is discovery only. Never fuzzy-match a product to a chemical result. */
export function evidenceForFood(input: FoodEvidenceQuery): FoodEvidenceBundle {
  const normalName = input.name?.trim().toLocaleLowerCase();
  const food = catalogueFood(input.foodId) ?? foodCatalogue.find(item => item.name.toLocaleLowerCase() === normalName);
  const studies = food ? foodEvidenceRecords.filter(record => record.foodIds.includes(food.id)) : [];
  return {
    foodId: food?.id, studies,
    indicators: (['PFAS', 'Lead'] as const).map(contaminant => {
      const evidenceCount = studies.filter(record => record.contaminant === contaminant).length;
      return { contaminant, label: evidenceCount ? 'Study available' : 'Guidance available', itemLevel: 'Unknown', evidenceCount };
    }),
    boundary: 'Published findings describe tested foods. Your item stays unmeasured unless a matching food-sample report is available. No study here is a current recall or a personal exposure estimate.',
    reviewedAt: foodEvidenceReviewedAt, revision: foodEvidenceRevision,
  };
}
