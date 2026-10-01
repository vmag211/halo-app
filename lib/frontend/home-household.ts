/**
 * Static, source-linked education for the editable Homeguard preview.
 * Household bands change the reading path, never a measurement or risk score.
 * These are not individual profiles or a backend-provided member advice matrix.
 */
export const homeMemberKeys = [
  'toddler', 'child', 'teen', 'adult', 'senior', 'pregnant', 'respiratory',
] as const;

export type HomeMemberKey = typeof homeMemberKeys[number];
export type HouseholdBands = Record<`has_${HomeMemberKey}`, boolean>;

export type HomeMemberAction = {
  factor: 'pfas' | 'lead' | 'radon' | 'mold';
  title: string;
  body: string;
  sourceLabel: string;
  sourceUrl: string;
};

type HomeMemberContent = {
  band: keyof HouseholdBands;
  label: string;
  shortLabel: string;
  intro: string;
  focus: string;
  actions: HomeMemberAction[];
};

const sources = {
  lead: {
    sourceLabel: 'EPA: Lead in drinking water',
    sourceUrl: 'https://www.epa.gov/ground-water-and-drinking-water/basic-information-about-lead-drinking-water',
  },
  pfas: {
    sourceLabel: 'EPA: PFAS and home filters',
    sourceUrl: 'https://www.epa.gov/cleanups/reducing-pfas-your-drinking-water-home-filter',
  },
  radon: {
    sourceLabel: 'EPA: Radon zones and home testing',
    sourceUrl: 'https://www.epa.gov/radon/epa-map-radon-zones',
  },
  moisture: {
    sourceLabel: 'EPA: Mold and moisture at home',
    sourceUrl: 'https://www.epa.gov/mold/brief-guide-mold-moisture-and-your-home',
  },
  mold: {
    sourceLabel: 'CDC: Mold and health',
    sourceUrl: 'https://www.cdc.gov/mold-health/about/index.html',
  },
} as const;

export const memberCatalog: Record<HomeMemberKey, HomeMemberContent> = {
  toddler: {
    band: 'has_toddler',
    label: 'Toddlers',
    shortLabel: 'Toddler',
    intro: 'A caregiver reading path for drinking water, everyday spaces, and small routines that help protect young children.',
    focus: 'Water used for drinks and meals, plus dry places to play.',
    actions: [
      {
        factor: 'lead', title: 'Start with the water they drink',
        body: 'Use cold tap water for drinking and food preparation. Boiling does not remove lead. A home-age estimate cannot tell you what is in this tap; ask your utility about testing.',
        ...sources.lead,
      },
      {
        factor: 'mold', title: 'Keep play spaces dry',
        body: 'Look for damp flooring, leaks, or condensation where they play. Fix the moisture source and dry wet materials promptly, ideally within 24 to 48 hours. An outdoor mold indicator does not inspect the room.',
        ...sources.moisture,
      },
      {
        factor: 'pfas', title: 'Match the filter to the finding',
        body: 'First confirm that the water result applies to your supply. If choosing a filter, check its specific PFAS reduction certification and replacement schedule. A general filtration label is not enough.',
        ...sources.pfas,
      },
    ],
  },
  child: {
    band: 'has_child',
    label: 'Children',
    shortLabel: 'Child',
    intro: 'Practical checks for the places children drink, learn, and play, with an adult handling testing and repairs.',
    focus: 'Drinking-water routines and the rooms used every day.',
    actions: [
      {
        factor: 'lead', title: 'Think beyond the kitchen tap',
        body: 'Ask about lead testing for drinking-water outlets at school or childcare as well as at home. A household plumbing estimate does not describe every place a child drinks.',
        ...sources.lead,
      },
      {
        factor: 'mold', title: 'Notice moisture early',
        body: 'Make it easy to tell an adult about musty smells, leaks, or wet carpet. The useful next step is fixing the moisture problem, not guessing the mold type from its color.',
        ...sources.mold,
      },
      {
        factor: 'radon', title: 'Check the home, not just the map',
        body: 'Ask a caregiver whether the home has a radon test result. A county zone is background context, not an indoor measurement. EPA recommends testing homes in every zone.',
        ...sources.radon,
      },
    ],
  },
  teen: {
    band: 'has_teen',
    label: 'Teens',
    shortLabel: 'Teen',
    intro: 'Clear explanations and everyday habits that teens can understand, without making them responsible for home hazards.',
    focus: 'Refilling bottles, spotting dampness, and understanding evidence.',
    actions: [
      {
        factor: 'lead', title: 'Build a bottle-refill habit',
        body: 'Use the cold tap for drinking water. If your household uses a lead-reduction filter, follow its instructions. Boiling water is not a substitute for addressing lead.',
        ...sources.lead,
      },
      {
        factor: 'mold', title: 'Help moisture escape',
        body: 'Use the bathroom exhaust fan when showering and tell an adult about recurring condensation or leaks. Ventilation helps control moisture; a visible mold problem also needs the source fixed.',
        ...sources.moisture,
      },
      {
        factor: 'radon', title: 'Know what a zone can tell you',
        body: 'A radon zone describes regional potential. It cannot confirm the air in a bedroom or study space. A home test is the next piece of evidence, regardless of the zone.',
        ...sources.radon,
      },
    ],
  },
  adult: {
    band: 'has_adult',
    label: 'Adults',
    shortLabel: 'Adult',
    intro: 'Turn the home information into a manageable plan: confirm the evidence, choose a practical step, and know what still needs testing.',
    focus: 'Water records, plumbing questions, and a home radon test.',
    actions: [
      {
        factor: 'pfas', title: 'Confirm the water supply first',
        body: 'Contact your water provider for current PFAS results before choosing treatment. Check the sampling date and which compounds were measured. A nearby result may not represent your supply.',
        ...sources.pfas,
      },
      {
        factor: 'lead', title: 'Ask a specific plumbing question',
        body: 'Ask your utility whether your service line is known to contain lead and how to arrange tap-water testing. A construction year is a clue, not confirmation of pipe material.',
        ...sources.lead,
      },
      {
        factor: 'radon', title: 'Replace an estimate with a test',
        body: 'Check whether you have a home radon result and arrange testing if you do not. EPA recommends testing in every zone. Keep the actual result separate from the regional estimate.',
        ...sources.radon,
      },
    ],
  },
  senior: {
    band: 'has_senior',
    label: 'Older adults',
    shortLabel: 'Senior',
    intro: 'A home-care reading path with easy-to-share steps. Age alone does not tell HALO about someone’s health, mobility, or support needs.',
    focus: 'Simple maintenance routines and help with testing when wanted.',
    actions: [
      {
        factor: 'pfas', title: 'Make filter upkeep easy to follow',
        body: 'If using a PFAS-reduction filter, keep its replacement instructions handy and arrange help if wanted. Filter performance depends on proper maintenance, not just installing it once.',
        ...sources.pfas,
      },
      {
        factor: 'mold', title: 'Plan help for damp areas',
        body: 'Arrange help with leaks or water damage if needed. If someone has health concerns, consult a health professional before mold cleanup. The moisture source needs fixing as well as the visible growth.',
        ...sources.moisture,
      },
      {
        factor: 'radon', title: 'Keep the test result understandable',
        body: 'Find out whether the home has been tested for radon and review the result together if helpful. A low-risk county zone cannot rule out an elevated level in this home.',
        ...sources.radon,
      },
    ],
  },
  pregnant: {
    band: 'has_pregnant',
    label: 'Pregnancy',
    shortLabel: 'Pregnant',
    intro: 'Source-backed home questions to discuss with your household and care team. These readings do not measure a person’s exposure or predict a pregnancy outcome.',
    focus: 'Drinking-water evidence and practical exposure-reduction questions.',
    actions: [
      {
        factor: 'lead', title: 'Give drinking-water questions attention',
        body: 'Lead can affect pregnancy. Use cold tap water for drinking and cooking, and ask your utility about testing if lead is a concern. Discuss possible exposure with your care team.',
        ...sources.lead,
      },
      {
        factor: 'pfas', title: 'Bring the water report, not just a score',
        body: 'Check whether the reported PFAS sample applies to your water supply. Bring the compound names and sampling date to questions for your water provider or care team. The result is not a personal exposure test.',
        ...sources.pfas,
      },
      {
        factor: 'radon', title: 'Use a home test for the home question',
        body: 'The radon map cannot determine an individual home’s level. Arrange a home test if no result is available. This is a general household step, not a pregnancy-specific risk calculation.',
        ...sources.radon,
      },
    ],
  },
  respiratory: {
    band: 'has_respiratory',
    label: 'Asthma / breathing',
    shortLabel: 'Respiratory Issue(s)',
    intro: 'Guidance for the breathing-sensitivity category you selected. This category can include asthma or other respiratory concerns; HALO does not infer a diagnosis.',
    focus: 'Dampness, indoor evidence, and clear limits on what a reading means.',
    actions: [
      {
        factor: 'mold', title: 'Take dampness seriously',
        body: 'Damp or moldy spaces can worsen symptoms for some people with asthma or mold allergies. Fix leaks and moisture problems. For individual symptoms or cleanup concerns, seek guidance from your care team.',
        ...sources.mold,
      },
      {
        factor: 'radon', title: 'Keep radon separate from symptom tracking',
        body: 'A regional radon estimate is not an indoor test or an explanation for today’s symptoms. Use a home test to establish the indoor level, whichever zone you live in.',
        ...sources.radon,
      },
      {
        factor: 'pfas', title: 'Read water evidence as water evidence',
        body: 'PFAS water results guide questions about your supply and possible treatment. They do not identify a breathing trigger. Check sample relevance and any filter’s specific PFAS reduction claim.',
        ...sources.pfas,
      },
    ],
  },
};

export const defaultPreviewBands: HouseholdBands = {
  has_toddler: true,
  has_child: false,
  has_teen: false,
  has_adult: false,
  has_senior: true,
  has_pregnant: true,
  has_respiratory: true,
};

export function isHomeMemberKey(value: unknown): value is HomeMemberKey {
  return typeof value === 'string' && homeMemberKeys.includes(value as HomeMemberKey);
}
