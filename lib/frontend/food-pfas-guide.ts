/** Curated education, not measured food results or a product lookup service. */
export const foodGuideReviewedAt = '2026-10-03';
export const foodGuideRevision = 'food-pfas-2026-10-03';
export const foodGuideSources = {
  fdaQuestions: { title: 'FDA: PFAS in food', url: 'https://www.fda.gov/food/process-contaminants-food/questions-and-answers-pfas-food', scope: 'U.S. consumer guidance' },
  fdaTesting: { title: 'FDA: food testing and dietary exposure', url: 'https://www.fda.gov/food/process-contaminants-food/testing-food-pfas-and-assessing-dietary-exposure', scope: 'Limited national and targeted sampling' },
  epa: { title: 'EPA: where PFAS can be found', url: 'https://www.epa.gov/pfas/our-current-understanding-human-health-and-environmental-risks-pfas', scope: 'Environmental pathways, not an item test' },
  extension: { title: 'NC State Extension: PFAS and home gardens', url: 'https://content.ces.ncsu.edu/Guide-to-Understanding-and-Addressing-PFAS-in-our-communities', scope: 'Garden uptake and evidence limitations' },
  fdaLead: { title: 'FDA: lead in food', url: 'https://www.fda.gov/food/environmental-contaminants-food/lead-food-and-foodwares', scope: 'Food and food-contact guidance, not an item test' },
};
export type FoodSourceKey = keyof typeof foodGuideSources;
export type FoodOrigin = 'store' | 'homegrown' | 'caught' | 'unknown';
export const foodOriginLabels: Record<FoodOrigin, string> = { store: 'Bought', homegrown: 'Homegrown', caught: 'Self-caught', unknown: 'Not sure' };
export type FoodGuide = {
  id: string; title: string; examples: string; aliases: string[];
  icon: 'fish' | 'produce' | 'dairy' | 'meat' | 'pantry';
  finding: string; findingSource: FoodSourceKey; limit: string;
  origins: FoodOrigin[]; question: string;
};
export const foodGuides: FoodGuide[] = [
  {
    id: 'seafood', title: 'Fish & seafood', examples: 'Salmon, tuna, shrimp, clams', aliases: ['salmon', 'tuna', 'shrimp', 'clam', 'clams', 'cod', 'pollock', 'tilapia', 'crab', 'bass', 'catfish', 'fish', 'seafood'], icon: 'fish',
    finding: 'FDA found PFAS in some seafood samples and has carried out targeted seafood studies. The findings describe the samples tested, not every fish or seafood product.', findingSource: 'fdaTesting',
    limit: 'HALO cannot tell what is in your fish from its name or the store where you bought it. A study is not a current recall.',
    origins: ['store', 'caught', 'unknown'], question: 'Is there a current notice that applies to this exact product or catch location?',
  },
  {
    id: 'produce', title: 'Fruit & vegetables', examples: 'Apples, tomatoes, spinach, carrots', aliases: ['apple', 'tomato', 'tomatoes', 'spinach', 'carrot', 'lettuce', 'fruit', 'vegetable', 'produce', 'berries', 'strawberry', 'potato', 'garden'], icon: 'produce',
    finding: 'Some plants can take up PFAS from contaminated soil or water. NC State Extension explains that uptake varies with the plant, chemical, soil and growing conditions.', findingSource: 'extension',
    limit: 'An area water reading cannot reveal the amount in a tomato or leaf. Your garden needs its own context, not a crop safety score.',
    origins: ['store', 'homegrown', 'unknown'], question: 'What evidence is available about the water and soil used to grow this food?',
  },
  {
    id: 'dairy', title: 'Milk & dairy', examples: 'Milk, yogurt, cheese', aliases: ['milk', 'dairy', 'yogurt', 'yoghurt', 'cheese', 'butter', 'cream'], icon: 'dairy',
    finding: 'EPA identifies dairy from livestock exposed to PFAS as one possible route into food. That describes a pathway, not a finding about your milk.', findingSource: 'epa',
    limit: 'A regional PFAS concern does not establish a result for a farm, brand or carton. Check the specific source and product before drawing a conclusion.',
    origins: ['store', 'unknown'], question: 'Does the producer or an official notice identify the product and lot I have?',
  },
  {
    id: 'meat', title: 'Meat & poultry', examples: 'Chicken, turkey, beef', aliases: ['meat', 'poultry', 'chicken', 'turkey', 'beef', 'pork', 'lamb'], icon: 'meat',
    finding: 'FDA includes meat and poultry in the broad range of grocery foods sampled for its Total Diet Study.', findingSource: 'fdaTesting',
    limit: 'The number of samples is limited. A category study cannot establish the PFAS content of a particular cut, flock or farm.',
    origins: ['store', 'unknown'], question: 'Is there product-specific information, rather than a finding about the wider food category?',
  },
  {
    id: 'pantry', title: 'Bread & pantry staples', examples: 'Bread, pasta, peanut butter', aliases: ['bread', 'pasta', 'macaroni', 'peanut', 'butter', 'salad', 'dressing', 'cake', 'cereal', 'rice', 'grain', 'pantry'], icon: 'pantry',
    finding: 'FDA food sampling includes breads and processed foods such as macaroni and cheese, peanut butter and salad dressing.', findingSource: 'fdaTesting',
    limit: 'A study of a food category is not a test of your package or ingredients. HALO does not grade products or estimate a PFAS dose.',
    origins: ['store', 'unknown'], question: 'Does the official source cover this exact product, package size and lot?',
  },
];

export const foodGuideEssentials = {
  diet: 'FDA recommends a varied, balanced diet, including seafood. A general PFAS concern is not a reason here to cut out an entire food group.',
  chemicals: 'PFAS is a family of chemicals, including PFOA and PFOS. A test measures particular compounds, not automatically the entire family.',
  boundary: 'Your kitchen tracks foods, not contamination. It cannot detect PFAS or lead. No matching result means unknown, not zero.',
  lead: 'Lead can enter food from growing and processing environments or some food-contact materials. FDA guidance does not tell us the amount in your particular food.',
};

export function searchFoodGuides(query: string) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return foodGuides.filter(guide => {
    const haystack = `${guide.title} ${guide.examples} ${guide.aliases.join(' ')}`.toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}
export function foodGuide(id?: string) { return foodGuides.find(guide => guide.id === id); }
export function foodOriginContext(guide: FoodGuide, origin: FoodOrigin) {
  const safeOrigin = guide.origins.includes(origin) ? origin : 'unknown';
  if (safeOrigin === 'caught') return {
    title: 'Start with the place it was caught',
    text: 'FDA recommends checking state fish and shellfish advisories for recreational catches. Use the waterbody, species and the audience in the official rule.',
    source: 'fdaQuestions' as FoodSourceKey, nextView: 'fish', nextTitle: 'Explore fish advisories', nextDetail: 'Check the official source for current advice.',
    question: 'Which current advisory applies to this waterbody, species and person eating the catch?',
  };
  if (safeOrigin === 'homegrown') return {
    title: 'Keep the growing conditions together',
    text: 'Record your irrigation source and any soil or water reports in My garden. These help you ask a more specific question without assuming the crop has been tested.',
    source: undefined, nextView: 'gardens', nextTitle: 'Open My garden', nextDetail: 'Connect the growing site, water source and questions.',
    question: 'What testing or local guidance is appropriate for my growing site and irrigation water?',
  };
  return {
    title: safeOrigin === 'store' ? 'Keep the exact product in view' : 'Start with what you know',
    text: safeOrigin === 'store' ? 'If you are checking a notice, compare its product name and lot with the package. Keep a question for the producer if the match is unclear.' : 'A food name alone is not enough to match a notice. You can keep a question now and add its origin later.',
    source: undefined, nextView: 'evidence', nextTitle: 'Explore food notices & studies', nextDetail: 'Example records show how product scope and study findings differ.', question: guide.question,
  };
}

export type FoodStorage = 'fridge' | 'pantry' | 'freezer';
export const foodStorageLabels: Record<FoodStorage, string> = { fridge: 'Fridge', pantry: 'Pantry', freezer: 'Freezer' };
export type PantryItem = { id: string; title: string; revision: number; guideId: string; origin: FoodOrigin; question: string; createdAt: string; updatedAt: string; guideRevision: string; foodId?: string; storage?: FoodStorage };
export const initialPantryItems: PantryItem[] = [];
export function validatePantryItem(item: Pick<PantryItem, 'title' | 'guideId' | 'origin' | 'question'> & Partial<Pick<PantryItem, 'storage'>>) {
  const guide = foodGuide(item.guideId);
  if (!guide) return 'Choose an available food guide.';
  if (!item.title.trim() || item.title.trim().length > 80) return 'Give this food note a name, up to 80 characters.';
  if (!guide.origins.includes(item.origin)) return 'Choose an origin that matches this food group.';
  if (item.storage !== undefined && !Object.hasOwn(foodStorageLabels, item.storage)) return 'Choose a storage section.';
  if ((!item.storage && !item.question.trim()) || item.question.trim().length > 500) return item.storage ? 'Keep the optional question within 500 characters.' : 'Write a question, up to 500 characters.';
  return '';
}
export function cleanFoodNote(text: string) { return text.trim().replace(/\u2014/g, ', '); }
