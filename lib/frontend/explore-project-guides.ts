/** Source-backed adaptations for a visit-local wireframe, not a live project service.
 * Exact plant/site suitability and specialist editorial approval remain release gates.
 * The two legacy IDs and numeric step keys are retained for this sample session.
 */
export type ProjectGuideSource = { id: string; title: string; publisher: string; url: string; checked: string; published?: string };
export type ProjectGuideStep = { title: string; instructions: string[]; checkpoint: string; sourceIds: string[] };
export type ProjectGuide = {
  id: string; version: string; title: string; cause: 'Water' | 'Habitats' | 'Community' | 'Energy';
  scene: 'garden' | 'trail' | 'river'; icon: 'plant' | 'bee' | 'cleanup' | 'sun' | 'water';
  description: string; purpose: string; effort: string; cost: string; scope: string;
  suitability: string; materials: string[]; constraints: string[]; steps: ProjectGuideStep[];
  completion: string; followup: string; sources: ProjectGuideSource[];
  buildPlan?: { title: string; note: string; parts: { name: string; quantity: number; size: string }[]; assembly: string[]; sourceId: string };
};

const checked = '2026-10-11';
const source = (id: string, title: string, publisher: string, url: string, published?: string): ProjectGuideSource => ({ id, title, publisher, url, checked, ...(published ? { published } : {}) });
const native = source('native', 'Native plants and seasonal habitat', 'NC State Extension', 'https://content.ces.ncsu.edu/extension-gardener-handbook/12-native-plants');
const woody = source('woody', 'Planting and establishing trees and shrubs', 'NC State Extension', 'https://content.ces.ncsu.edu/extension-gardener-handbook/11-woody-ornamentals');
const wildlife = source('wildlife', 'Landscaping for wildlife with native plants', 'NC State Extension', 'https://content.ces.ncsu.edu/landscaping-for-wildlife-with-native-plants');
const beeDesign = source('bee-design', 'Bee hotel design, placement and maintenance', 'NC State Extension', 'https://content.ces.ncsu.edu/how-to-manage-a-successful-bee-hotel/bee-hotel-design-and-placement', '2022-07-06');
const beeCheck = source('bee-check', 'Bee hotel checklist', 'NC State Extension', 'https://content.ces.ncsu.edu/how-to-manage-a-successful-bee-hotel/appendix-1-bee-hotel-checklist', '2022-07-06');
const beeBuild = source('bee-build', 'Measured wooden shelter building plans', 'NC State Extension', 'https://content.ces.ncsu.edu/how-to-manage-a-successful-bee-hotel/appendix-4-building-plans-for-a-simple-bee-hotel-shelter', '2022-07-06');
const cleanup = source('cleanup', 'Request cleanup supplies and report your work', 'City of Charlotte', 'https://www.charlottenc.gov/Streets-and-Neighborhoods/Get-Involved/Keep-Charlotte-Beautiful');
const cleanupSafety = source('cleanup-safety', 'Volunteer litter-cleanup safety', 'NCDOT', 'https://www.ncdot.gov/initiatives-policies/environmental/adoptahighway/Pages/safety-guidelines.aspx', '2026-02-18');
const solar = source('solar', 'Build a solar oven design challenge (PDF)', 'NASA', 'https://www.nasa.gov/wp-content/uploads/2024/02/nasa-lp-solar-oven.pdf');
const solarEnergy = source('solar-energy', 'How solar ovens collect energy', 'NASA Earth Observatory', 'https://science.nasa.gov/earth/earth-observatory/power-to-the-people/');
const ccr = source('ccr', 'Find a public water system report', 'US EPA', 'https://www.epa.gov/ccr', '2026-09-09');
const well = source('well', 'Private-well testing and qualified resources', 'US EPA', 'https://www.epa.gov/privatewells/protect-your-homes-water', '2026-02-26');

export const projectGuides: ProjectGuide[] = [
  {
    id: 'demo-habitat-project', version: '2026-10-11.1', title: 'Plant a native pollinator space', cause: 'Habitats', scene: 'garden', icon: 'plant',
    description: 'Turn a patch of your yard into a planted space, with a care plan you can keep.',
    purpose: 'Provide locally suitable flowers and habitat. Start small enough to maintain; HALO does not estimate pollinator or farm benefits.',
    effort: 'A site check, planting day and ongoing care', cost: 'Plants, tools and mulch vary locally. No price estimate is loaded.', scope: 'North Carolina guidance. Recheck species and growing conditions elsewhere.',
    suitability: 'A permitted yard or shared garden. A container is an alternative for flowers, not a substitute for a tree planting site.',
    materials: ['Site sketch and measuring tape', 'Locally suitable native plants with labels', 'Gloves, hand trowel or shovel', 'Watering can or hose and organic mulch'],
    constraints: ['Get the owner’s permission and locate buried utilities before digging.', 'Check mature plant size, local rules and access. Do not disturb established tree roots.', 'Have a reachable water source and someone able to maintain the planting.'],
    steps: [
      { title: 'Check the space and get permission', instructions: ['Sketch the planting area. Note sunlight in the morning, midday and late afternoon, drainage, and available space.', 'Confirm permission and utility-marking requirements before excavation. Choose a smaller accessible area if digging or ongoing care is difficult.'], checkpoint: 'Record the permitted area, observed conditions and who will maintain it.', sourceIds: ['native', 'woody'] },
      { title: 'Choose native plants for this site', instructions: ['Match plants to your observed light, moisture and mature size using the linked Extension guidance.', 'Aim for flowers across spring, summer and fall. Eastern redbud, cardinal flower and goldenrod are examples to investigate, not automatic recommendations for your site.', 'Sketch spacing at mature size and retain plant names and nursery instructions.'], checkpoint: 'Keep a plant list with its site requirements before buying or digging.', sourceIds: ['native', 'wildlife'] },
      { title: 'Plant without burying the crown', instructions: ['For a small container-grown tree or shrub, measure the root ball. Dig only that deep and make the hole two to three times wider; roughen slick sides.', 'Handle the plant by its root ball. Ask the nursery about circling roots. Position the trunk flare at or slightly above the surrounding ground.', 'Backfill with the removed soil, water it in and finish level with surrounding ground. Add 2 to 3 inches of organic mulch, keeping it at least 6 inches from the trunk.', 'For flowers, follow their planting-depth instructions rather than applying the tree dimensions.'], checkpoint: 'Record the species, planting date and number planted. A photo is optional, not proof of a benefit.', sourceIds: ['woody'] },
      { title: 'Keep a care and seasonal check', instructions: ['Check root-ball moisture during establishment; adjust watering to rain and site conditions instead of a fixed app schedule.', 'Keep mulch away from stems. Note survival, bloom timing and weeds, and ask Extension about problems you cannot identify.', 'Choose your own check-back date and record what needs replacing or adjusting.'], checkpoint: 'Save a care plan and one factual follow-up observation.', sourceIds: ['woody', 'native'] },
    ],
    completion: 'A permitted site was planted, plant names and date were recorded, and a care check was chosen. A plan alone can remain paused instead of being marked planted.',
    followup: 'Review establishment and bloom gaps later. Record survival or observed visitors without turning them into a measured biodiversity increase.', sources: [native, wildlife, woody],
  },
  {
    id: 'bee-house', version: '2026-10-11.1', title: 'Make a small solitary-bee house', cause: 'Habitats', scene: 'garden', icon: 'bee',
    description: 'Build or assemble a modest nesting shelter, then take responsibility for its maintenance.',
    purpose: 'Offer nesting space for cavity-nesting bees. A hotel is not a honeybee hive or a guaranteed conservation benefit.',
    effort: 'Assembly, placement and seasonal maintenance', cost: 'Use a suitable existing shelter or price untreated wood and nesting materials locally.', scope: 'NC State guidance for North Carolina. Species and seasonal timing differ elsewhere.',
    suitability: 'A permitted garden with flowers and a sheltered mounting point. Choose habitat planting instead if you cannot maintain nests.',
    materials: ['Small wooden housing and mounting hardware, or the cut list below', 'Natural reeds or plant stems, smooth and closed at one end', 'Ruler, saw, drill, clamps, wood glue and 23 #8 × 1¼-inch trim screws for the source build', 'Opaque emergence box with protected exit holes for later maintenance'],
    constraints: ['Adults handle cutting, drilling and secure mounting. Avoid entrances where people must brush past nests.', 'Do not purchase or release bees. Never open, clean or discard occupied nests.', 'Do not use plastic or glass tubes, exposed paper straw bundles, pinecones or moss as nesting material.'],
    steps: [
      { title: 'Choose a maintainable design', instructions: ['Keep the shelter small, with fewer than 100 tunnels. Check that you can remove and replace nesting materials later.', 'For a wooden build, use the linked measured shelter plan with an experienced adult. It includes its cut list, roof assembly and mounting directions.', 'Prepare an emergence box before installing nests, so used tubes can be retired without trapping residents.'], checkpoint: 'Choose a build or assembly method and name the person responsible for upkeep.', sourceIds: ['bee-design', 'bee-build'] },
      { title: 'Prepare breathable nesting tubes', instructions: ['Use natural reeds or stems with one closed end and smooth, splinter-free entrances.', 'Use varied diameters from about 2 to 12.7 mm; lengths around 6 inches, or 3 to 8 inches, suit the Extension guide. Do not treat one diameter as suitable for every bee.', 'Keep tubes secured inside the shelter. Paper liners belong inside sturdy wooden tunnels, not as loose exposed bundles.'], checkpoint: 'Record tube material, lengths and approximate tunnel count.', sourceIds: ['bee-check'] },
      { title: 'Mount a sheltered, stable house', instructions: ['Protect the entrances with a roof overhang of a couple of inches and provide drainage in the shelter floor.', 'Mount about 5 feet above ground where observation is easy and vegetation cannot block entrances. Follow mounting-hardware instructions.', 'Consider morning sun, afternoon shade and prevailing wind; southeast is a common starting orientation, not a universal rule. Keep nearby flowers available.'], checkpoint: 'Record the location, mounting check and sunlight you actually observe.', sourceIds: ['bee-check', 'bee-design'] },
      { title: 'Observe and renew responsibly', instructions: ['During active nesting, leave tubes and entrances in place. Observe from a distance without opening nests.', 'In fall or winter, follow the source to move intact occupied tubes into an opaque emergence box. Keep it cold and protected, not in a heated home.', 'If stored in an unheated shed, bring the box outdoors after the last spring frost so emerging insects can leave. Restock the main house with fresh tubes.', 'Keep used tubes in the emergence box for a full growing season before retiring them. Follow the source to ensure residents have left rather than guessing emptiness.'], checkpoint: 'Keep an observation and a seasonal maintenance plan, even if no nests are used.', sourceIds: ['bee-design'] },
    ],
    completion: 'A stable shelter was installed and a responsible emergence-box and maintenance plan was recorded. No occupancy is required to honestly record assembly.',
    followup: 'Check shelter condition and later seasonal maintenance. A capped tube is an observation, not a species identification or a count of bees saved.', sources: [beeDesign, beeCheck, beeBuild],
    buildPlan: {
      title: 'Bee house cut list and assembly', note: 'An experienced adult uses the source diagrams before cutting. Sizes below are actual dimensions, not nominal lumber labels. Tool instructions and protective equipment still apply.',
      parts: [
        { name: 'A, short roof', quantity: 1, size: '¾ × 9¼ × 6¼ inches' },
        { name: 'B, long roof', quantity: 1, size: '¾ × 9¼ × 7 inches' },
        { name: 'C, sides', quantity: 2, size: '¾ × 7¼ × 6¾ inches; one end beveled 45°' },
        { name: 'D, floor and shelf', quantity: 2, size: '¾ × 5½ × 6½ inches' },
        { name: 'E, back', quantity: 1, size: '¾ × 5½ × 9½ inches; top mitered for a 45° roof' },
      ],
      assembly: ['Join one side (C) to the back (E) with glue, clamps and screws.', 'Attach the floor and shelf (D), leaving 3¾ inches between them. Add the other side (C).', 'Attach short roof (A), then long roof (B), as the source diagrams show. Sand rough surfaces and let the chosen exterior finish cure.', 'Secure the back to a suitable support with mounting hardware. Add breathable nesting material only after the housing is stable.'], sourceId: 'bee-build',
    },
  },
  {
    id: 'community-cleanup', version: '2026-10-11.1', title: 'Host an organizer-supported cleanup', cause: 'Community', scene: 'trail', icon: 'cleanup',
    description: 'Bring a small group together with permission, supplies, a safety briefing and a disposal plan.',
    purpose: 'Remove ordinary litter from an approved area and leave a clear record for the organizer. Avoid hazardous or unsupervised collection.',
    effort: 'Organizer preparation, a cleanup and a report', cost: 'Charlotte offers borrowed supplies to residents. Confirm availability and eligibility with the program.', scope: 'Charlotte organizer example. Use the responsible program for your actual location.',
    suitability: 'A small group with a responsible lead on a permitted, accessible route. Ask about non-collecting roles if litter pickup is unsuitable.',
    materials: ['Organizer-confirmed gloves, litter grabbers, bags and any required vests', 'Closed-toe sturdy shoes, water and weather-appropriate clothing', 'Approved meeting point, route and bag-disposal instructions', 'Organizer waivers, supervision arrangements and cleanup report'],
    constraints: ['This guide does not authorize roadway or stream work. Use an official supervised program for those settings.', 'Do not enter water, private property, traffic lanes or restricted areas.', 'Never touch needles, unknown containers or hazardous material. Tell the responsible organizer or authority.'],
    steps: [
      { title: 'Agree on the site with an organizer', instructions: ['Use a local program to confirm permission, boundaries, suitable work and who leads the activity.', 'Charlotte residents can use Keep Charlotte Beautiful’s cleanup registration and supply request. An application is not an approved event.', 'Confirm supervision, age rules, accessible roles, cancellation criteria and where bags will be collected.'], checkpoint: 'Record the organizer’s response, approved route and meeting place before inviting others.', sourceIds: ['cleanup', 'cleanup-safety'] },
      { title: 'Prepare people, supplies and disposal', instructions: ['Request supplies early and check the actual pickup and return arrangements. Charlotte asks for signed liability waivers and borrowed supplies returned within one week.', 'Tell participants what to wear, where to meet, how to reach the lead and what work they will do.', 'Arrange the organizer-approved bag pickup or disposal. Do not leave bags beside a drain or assume city collection.'], checkpoint: 'Keep a supply list, participant instructions and confirmed disposal plan.', sourceIds: ['cleanup'] },
      { title: 'Brief the group and clean the approved area', instructions: ['Before starting, review route boundaries, supervision, stop conditions and hazard reporting. Work in daylight and suitable weather.', 'Wear the required gear, use grabbers for ordinary litter and avoid overfilled bags. Keep clear of equipment and construction.', 'Leave needles, suspicious containers and unsafe items untouched. Stop when conditions become unsafe and report the location to the organizer.'], checkpoint: 'Record only the work actually done, optional hours and items left for qualified removal.', sourceIds: ['cleanup-safety'] },
      { title: 'Close out and choose a follow-up', instructions: ['Use the agreed disposal route, return borrowed equipment and submit the organizer’s cleanup report.', 'Record bag counts only if you counted them; record weight only if it was measured. Do not estimate pollution removed from hours or steps.', 'Ask the organizer what worked and whether another approved activity is useful before repeating.'], checkpoint: 'Keep the report reference or your own factual summary, then choose a check-back if needed.', sourceIds: ['cleanup'] },
    ],
    completion: 'The approved activity happened, disposal and equipment return were resolved, and a factual report was recorded. Weather cancellation can remain paused.',
    followup: 'Follow up on hazards through official channels and ask about another suitable activity. HALO does not verify attendance or agency responses.', sources: [cleanup, cleanupSafety],
  },
  {
    id: 'solar-oven', version: '2026-10-11.1', title: 'Build a solar-energy experiment', cause: 'Energy', scene: 'trail', icon: 'sun',
    description: 'Make a simple solar oven, measure temperature and improve one part of your design.',
    purpose: 'Explore how sunlight can be collected and converted to heat. This is a learning experiment, not a food-safety or energy-savings claim.',
    effort: 'One supervised build and a sunny-day test', cost: 'Reuse clean materials where practical. A suitable thermometer may need to be borrowed or purchased.', scope: 'Adapted from NASA’s classroom design challenge. Outdoor results depend on conditions.',
    suitability: 'A sunny permitted space, an adult supervising tools and heating, and a thermometer suitable for the experiment.',
    materials: ['Clean cardboard box at least 40 cm wide, foil and black construction paper', 'Transparent plastic wrap, tape and an aluminum pie pan', 'Thermometer, timer and a sheet for recording time and temperature', 'Adult-handled cutting tools and heat protection'],
    constraints: ['Use this version without food. It cannot establish that food is safe to eat or water is disinfected.', 'An adult handles tools and hot surfaces. Stay with the experiment and let parts cool before touching.', 'Do not stare at the Sun or direct reflected light toward eyes, roads or flammable materials.'],
    steps: [
      { title: 'Draw a testable design', instructions: ['Sketch a box with a dark absorbing surface, foil to redirect light and a transparent cover to retain heat.', 'Choose where the thermometer will sit and how you will read it consistently. Use a stable sunny spot and plan one design change to compare later.'], checkpoint: 'Keep your sketch and write what you predict will happen.', sourceIds: ['solar', 'solar-energy'] },
      { title: 'Assemble the oven in order', instructions: ['Line the interior sides with foil. Lay black paper on the box floor and put the empty pan and thermometer inside before adding the transparent cover.', 'Tape the cover securely while keeping the thermometer readable. Stabilize any reflector so it cannot blow or shine toward people.', 'Check the whole assembly with the supervising adult before placing it in sun. Stop if materials soften or scorch.'], checkpoint: 'Record the materials and thermometer placement you used.', sourceIds: ['solar'] },
      { title: 'Measure rather than guess', instructions: ['Record the initial temperature and time, then read again after 5 minutes. Note units, sunlight, clouds and any movement.', 'NASA’s challenge uses a 5°C rise in 5 minutes as a design target, not a promised result. Keep your actual result even when the oven does not warm.', 'Do not add invented readings or translate temperature change into household energy savings.'], checkpoint: 'Keep the starting and ending readings, units, elapsed time and conditions.', sourceIds: ['solar'] },
      { title: 'Change one thing and repeat', instructions: ['Let the setup cool. Choose one change, such as reflector position or the absorbing surface, and explain why.', 'Repeat the same timed test as closely as conditions allow. Note differences in sun or weather that limit comparison.', 'Compare your actual readings and describe what you learned. Reuse or dispose of materials responsibly.'], checkpoint: 'Record the changed design, a second test and one limitation of the comparison.', sourceIds: ['solar', 'solar-energy'] },
    ],
    completion: 'The oven was built, real temperatures were recorded and a design change was tested or explained as not feasible. A temperature target need not be met.',
    followup: 'Choose another controlled comparison if useful. This teaches an energy concept but does not demonstrate a household emission reduction.', sources: [solar, solarEnergy],
  },
  {
    id: 'demo-water-project', version: '2026-10-11.1', title: 'Get to know your water', cause: 'Water', scene: 'river', icon: 'water',
    description: 'Get a dated source, ask a specific question and carry the answer into your home records.',
    purpose: 'Resolve a practical water-information question without treating a public system sample as a test of your own tap.',
    effort: 'Three short sessions, at your pace', cost: 'Reading public information has no app fee. Ask a certified lab for any testing quote.', scope: 'US public-system reports and private-well resources; local testing needs vary.',
    suitability: 'Renters, owners and private-water households. No sampling equipment is needed for this information project.',
    materials: ['Your specific question', 'Water provider name or known private-well context', 'A dated public report or your own existing lab result', 'A place to keep the source and reply'],
    constraints: ['Use a certified laboratory’s own collection instructions for testing.', 'Do not infer contamination or safe water from appearance, a missing value or a map pattern.', 'A reply or checklist does not replace a home measurement.'],
    steps: [
      { title: 'Write down what you want to understand about your water.', instructions: ['Write one answerable question, such as which dated report applies to your provider or which certified lab can address your testing concern.', 'Record whether the question is about a public water system or a private well. Leave an uncertain provider name uncertain.'], checkpoint: 'Keep a question and the known water context, without guessing a result.', sourceIds: ['ccr', 'well'] },
      { title: 'Review a dated source or the test records you already have.', instructions: ['For a public supply, use EPA’s report finder or the provider’s official site. Keep the report year, provider name and link.', 'For an existing lab result, keep the sample date, matrix, units and qualifications. A utility report and a tap sample have different scopes.'], checkpoint: 'Record one dated source and what it can actually tell you.', sourceIds: ['ccr'] },
      { title: 'Choose a provider, lab or public resource to ask.', instructions: ['Ask the water provider about its report. For a private well, contact the local health department or a state-certified drinking-water laboratory.', 'Ask which tests or records address the question, what the costs are and whose sampling instructions must be followed. Do not collect a sample before obtaining the lab’s instructions.'], checkpoint: 'Keep the contact route and your prepared question. Opening a website is not a reply.', sourceIds: ['well', 'ccr'] },
      { title: 'Record what you learned and choose a follow-up.', instructions: ['Record the answer and its date, or note that you are waiting. Preserve the original question and source.', 'If you choose testing, continue into Homeguard to record actual arrangements and results. Deliberately save a follow-up in My Week rather than treating the reply date as a due date.'], checkpoint: 'Keep the answer, remaining uncertainty and a next step you chose.', sourceIds: ['well'] },
    ],
    completion: 'A source was reviewed, the question was resolved or its remaining limits recorded, and a deliberate follow-up was chosen.',
    followup: 'Review the response, source date or a new home test when available. No score changes merely because the project is completed.', sources: [ccr, well],
  },
];

export const projectGuideCauses = ['All projects', 'Habitats', 'Community', 'Energy', 'Water'] as const;
export function findProjectGuide(id: string): ProjectGuide | undefined { return projectGuides.find(guide => guide.id === id); }
export function searchProjectGuides(query: string, cause = 'All projects'): ProjectGuide[] {
  const terms = query.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
  return projectGuides.filter(guide => (cause === 'All projects' || guide.cause === cause) && terms.every(term => `${guide.title} ${guide.cause} ${guide.description} ${guide.materials.join(' ')}`.toLocaleLowerCase('en').includes(term)));
}
export function projectStepIndex(value: number, count: number): number { return Number.isInteger(value) && value >= 0 ? Math.min(value, Math.max(0, count - 1)) : 0; }
export function projectActionKey(id: string, index: number): string | null {
  const guide = findProjectGuide(id);
  return guide && Number.isInteger(index) && index >= 0 && index < guide.steps.length ? `explore:project:${id}:step:${index}` : null;
}
export function projectCompletionError(completed: number, total: number, result: string): string | null {
  if (total < 1 || completed !== total) return 'Save and explicitly complete each project step before recording whole-project completion.';
  if (!result.trim()) return 'Describe the result you actually recorded before completing the project.';
  if (result.length > 2000) return 'Keep your project result under 2,000 characters.';
  return null;
}
