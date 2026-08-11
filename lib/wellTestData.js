// ============================================================
// PRIVATE WELL / SPRING WATER TEST CATALOG
// ============================================================
//
// WHY THIS FILE EXISTS
// --------------------
// Public water utilities are regulated under the Safe Drinking Water Act.
// The utility is legally required to test its own water and report results —
// that is exactly where our UCMR5 / PFAS data comes from.
//
// Private wells and springs are NOT covered by the Safe Drinking Water Act.
// Nobody tests them. There is no utility, no PWSID, no public dataset to
// look up, and no legal requirement for anyone to check the water at all.
// The homeowner is the only person responsible for testing it.
//
// So for these users we cannot show them a measurement. What we CAN do is
// tell them exactly which tests to run, in what order, and roughly what it
// costs — which is genuinely more actionable than a number they can't get.
//
// COST ESTIMATES — READ BEFORE DEMO
// ---------------------------------
// Every cost below is a ballpark range, marked `is_estimate: true` in the
// API response. They are NOT verified against a primary source yet.
// TODO(vibhav): verify against the NC State Laboratory of Public Health
// fee schedule and 2-3 county health department well-testing price lists
// before the CAC submission, then drop this comment. Same discipline we
// used for the radon zones — no unverified dataset ships as fact.
//
// Everything else in this file (which contaminants matter for wells, why,
// and how often to test) follows standard EPA/CDC private-well guidance,
// which is general public-health advice rather than a per-county dataset.

// ============================================================
// THE CATALOG
// ============================================================
// Each entry describes one test. `priority` drives the ordering of the
// final plan: critical -> recommended -> optional.

export const WELL_TEST_CATALOG = {
  bacteria: {
    id: 'bacteria',
    name: 'Total Coliform & E. coli',
    priority: 'critical',
    cadence: 'Every year',
    cost_low: 15,
    cost_high: 40,
    why: 'This is the single most important well test. Coliform bacteria mean surface water is getting into your well — usually through a cracked casing or a bad seal. E. coli specifically means sewage or animal waste contamination. This is the one that can make your family sick this week, not in twenty years.',
    where: 'Your county health department almost always runs this test, and it is usually the cheapest option available.',
  },

  nitrate: {
    id: 'nitrate',
    name: 'Nitrate & Nitrite',
    priority: 'critical',
    cadence: 'Every year',
    cost_low: 15,
    cost_high: 35,
    why: 'Nitrate comes from fertilizer, septic systems, and animal waste soaking into groundwater. It is the one contaminant with a real, fast danger to infants — high nitrate keeps a baby\'s blood from carrying oxygen properly. If anyone in the home is pregnant or under one year old, treat this as urgent rather than routine.',
    where: 'Usually bundled with the bacteria test at the county health department.',
  },

  ph_corrosivity: {
    id: 'ph_corrosivity',
    name: 'pH & Corrosivity',
    priority: 'recommended',
    cadence: 'Every 3 years',
    cost_low: 10,
    cost_high: 30,
    why: 'Well water in this region is often naturally acidic. Acidic water does not hurt you directly, but it eats away at your plumbing and pulls metal out of the pipes into your glass. This test is how you find out whether your pipes are actively leaching into your water.',
    where: 'Included in most basic well panels.',
  },

  lead_copper: {
    id: 'lead_copper',
    name: 'Lead & Copper',
    priority: 'critical',
    cadence: 'Once, then again after any plumbing work',
    cost_low: 20,
    cost_high: 50,
    why: 'A city utility adds corrosion-control chemicals to stop pipes leaching lead. On a private well, nobody does that for you — you are your own treatment plant. Combined with plumbing from an era when lead solder was still legal, this is the highest-value one-time test you can run.',
    where: 'County health department or a state-certified lab. Follow the first-draw instructions exactly — the water must sit in the pipes overnight or the result is meaningless.',
  },

  radon_in_water: {
    id: 'radon_in_water',
    name: 'Radon in Water',
    priority: 'recommended',
    cadence: 'Once',
    cost_low: 25,
    cost_high: 60,
    why: 'Radon is a gas that comes out of uranium in the bedrock. In a high-radon area it does not just seep up through your foundation — it dissolves into groundwater and then releases into the air every time you run a shower or a dishwasher. Homes on wells in high-radon counties can get a second dose of radon that a home on city water never sees.',
    where: 'Needs a lab that specifically handles radon-in-water. This is a different test from the air kit and the two are not interchangeable.',
  },

  radon_in_air: {
    id: 'radon_in_air',
    name: 'Radon in Air (home test kit)',
    priority: 'critical',
    cadence: 'Once, then every 2 years',
    cost_low: 15,
    cost_high: 30,
    why: 'Radon is the second leading cause of lung cancer in the United States and it is completely invisible without a test. In a Zone 1 county the odds are genuinely high, and the test is a cheap cardboard kit you leave in your basement for a few days and mail in.',
    where: 'Hardware stores carry these, and many NC county health departments hand them out free or heavily discounted.',
  },

  metals_panel: {
    id: 'metals_panel',
    name: 'Heavy Metals Panel (arsenic, manganese, iron)',
    priority: 'recommended',
    cadence: 'Once, then every 5 years',
    cost_low: 40,
    cost_high: 120,
    why: 'These are naturally occurring — they leach out of the rock the well is drilled into, so they have nothing to do with pollution and everything to do with local geology. Arsenic in particular is known to show up in some North Carolina bedrock, and you cannot taste or smell it.',
    where: 'A state-certified lab. Ask specifically for arsenic; some cheap panels leave it out.',
    // NOTE: arsenic risk is genuinely regional within NC, but we do not yet
    // have a verified county-level arsenic dataset. Until we do, this is
    // recommended statewide rather than targeted. Flagged in the response
    // as needs_local_context so we never imply we measured anything.
    needs_local_context: true,
  },

  pfas: {
    id: 'pfas',
    name: 'PFAS ("forever chemicals")',
    priority: 'optional',
    cadence: 'Once, if you have reason to suspect a source',
    cost_low: 200,
    cost_high: 400,
    why: 'This is the same family of chemicals HALO tracks for city utilities. It is on the optional list purely because of cost — it is by far the most expensive test here. It moves up the list if you live near a military base, an airport, a landfill, or a textile or chemical plant, since firefighting foam and industrial discharge are the usual sources.',
    where: 'A specialty lab. Confirm they test to EPA Method 533 or 537.1 before paying.',
    needs_local_context: true,
  },
};

// The year lead solder stopped being legal in US drinking water plumbing.
// The 1986 Safe Drinking Water Act amendments banned it, taking effect in
// 1988. Plumbing installed before then may contain lead solder joints even
// if the pipes themselves are copper.
const LEAD_SOLDER_BAN_YEAR = 1988;

// ============================================================
// THE PLAN BUILDER
// ============================================================
// Takes what we already know about this specific home and returns an
// ordered, deduplicated list of tests plus a rough total cost.
//
// radonZone  - 1, 2, 3, or null/undefined if the county wasn't found
// homeYear   - integer year built, or null if the user didn't tell us
// waterSource- 'well' or 'spring' (spring gets one extra warning)

const PRIORITY_ORDER = { critical: 0, recommended: 1, optional: 2 };

export function buildWellTestPlan({ radonZone, homeYear, waterSource }) {
  // We collect test IDs first, then look them up. Using a Set means we
  // never accidentally recommend the same test twice if two different
  // conditions both point at it.
  const selectedIds = new Set();
  const reasons = [];

  // --- 1. THE BASELINE: every private well gets these, no exceptions ---
  selectedIds.add('bacteria');
  selectedIds.add('nitrate');
  selectedIds.add('ph_corrosivity');
  reasons.push(
    'Bacteria and nitrate are the standard annual baseline for any private well, regardless of location or age.'
  );

  // --- 2. RADON: driven by the county's EPA radon zone ---
  // Zone 1 = highest predicted indoor radon, Zone 3 = lowest.
  if (radonZone === 1 || radonZone === 2) {
    selectedIds.add('radon_in_air');
    selectedIds.add('radon_in_water');
    reasons.push(
      `This county is EPA radon Zone ${radonZone}, so radon is worth testing both in the air and in the well water.`
    );
  } else if (radonZone === 3) {
    // Still worth the cheap air kit — Zone 3 is "lower predicted average,"
    // not "safe." Individual homes in Zone 3 counties do test high.
    selectedIds.add('radon_in_air');
    reasons.push(
      'This county is EPA radon Zone 3 (lower predicted levels), but individual homes still test high, so the cheap air kit is worth doing once.'
    );
  } else {
    // County wasn't in the dataset — be honest rather than guessing.
    selectedIds.add('radon_in_air');
    reasons.push(
      'We could not match this county to an EPA radon zone, so the air test is included as a precaution rather than because of a known local risk.'
    );
  }

  // --- 3. LEAD: driven by the age of the home's plumbing ---
  if (homeYear && homeYear < LEAD_SOLDER_BAN_YEAR) {
    selectedIds.add('lead_copper');
    reasons.push(
      `This home was built in ${homeYear}, before lead solder was banned in ${LEAD_SOLDER_BAN_YEAR}, and a private well has no utility corrosion control to offset it.`
    );
  } else if (!homeYear) {
    selectedIds.add('lead_copper');
    reasons.push(
      'We do not know the year this home was built, so lead is included by default — a private well has no utility corrosion control to fall back on.'
    );
  }

  // --- 4. GEOLOGY AND INDUSTRY: always offered, clearly caveated ---
  selectedIds.add('metals_panel');
  selectedIds.add('pfas');

  // --- 5. Turn IDs into full entries and sort worst-first ---
  const tests = Array.from(selectedIds)
    .map((id) => WELL_TEST_CATALOG[id])
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    .map((test, index) => ({
      rank: index + 1,
      id: test.id,
      name: test.name,
      priority: test.priority,
      cadence: test.cadence,
      why: test.why,
      where: test.where,
      needs_local_context: test.needs_local_context || false,
      estimated_cost: {
        low: test.cost_low,
        high: test.cost_high,
        is_estimate: true,
      },
    }));

  // --- 6. Rough total, split so the UI can show "start here" vs "everything" ---
  const criticalTests = tests.filter((t) => t.priority === 'critical');
  const sumRange = (list) => ({
    low: list.reduce((total, t) => total + t.estimated_cost.low, 0),
    high: list.reduce((total, t) => total + t.estimated_cost.high, 0),
    is_estimate: true,
  });

  // Springs are surface-fed, so they are far more exposed to runoff,
  // animals, and rain events than a drilled well is.
  if (waterSource === 'spring') {
    reasons.push(
      'A spring is fed by surface water, which makes bacterial contamination much more likely than it is for a drilled well — especially after heavy rain. Test more often than once a year if you can.'
    );
  }

  return {
    tests,
    reasons,
    start_here_cost: sumRange(criticalTests),
    full_panel_cost: sumRange(tests),
  };
}
