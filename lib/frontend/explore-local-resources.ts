/** Source-reviewed participation routes, not live events or a verified directory. */
export type LocalResourceScope = 'examples' | 'charlotte' | 'union' | 'basin' | 'elsewhere';
export type LocalResourceInterest = 'Cleanup' | 'Trees & habitat' | 'Gardening' | 'Community learning';
export type LocalParticipationResource = {
  id: string; title: string; organizer: string; interest: LocalResourceInterest;
  scopes: LocalResourceScope[]; area: string; mission: string; work: string;
  url: string; sourceTitle: string; extraSources?: { title: string; url: string }[];
  address?: string; addressRole?: string; contact?: string;
  effort: string; age: string; cost: string; access: string;
  steps: { title: string; text: string }[]; bring: string; followup: string;
};

export const localResourceReviewDate = '11 October 2026';
export const localParticipationResources: LocalParticipationResource[] = [
  {
    id: 'charlotte-cleanup', title: 'Start a neighborhood cleanup', organizer: 'Keep Charlotte Beautiful', interest: 'Cleanup', scopes: ['charlotte'], area: 'Charlotte city limits',
    mission: 'A City of Charlotte program supporting litter prevention, waste reduction and community greening.', work: 'Arrange your own cleanup with borrowed supplies, or find organizer-led activities.',
    url: 'https://www.charlottenc.gov/Streets-and-Neighborhoods/Get-Involved/Keep-Charlotte-Beautiful', sourceTitle: 'City cleanup program and supply requests',
    effort: 'Choose one cleanup, or explore recurring street adoption.', age: 'Not specified here. Confirm supervision and waiver requirements.', cost: 'Cleanup supplies are loaned free to Charlotte residents.', access: 'Site-specific access is not supplied. Ask about terrain, parking and suitable roles.',
    steps: [
      { title: 'Choose a supported route', text: 'On the city page, choose Cleanup Litter Anytime or Volunteer Brigade. Street adoption is a separate ongoing commitment.' },
      { title: 'Arrange supplies and permission', text: 'Use the linked pre-registration form. Confirm your site, collection arrangements and liability waiver with the program.' },
      { title: 'Prepare, then participate', text: 'Confirm the meeting place and safety instructions before going. The city lends grabbers, gloves, vests and bags.' },
      { title: 'Close the loop', text: 'Submit the city cleanup report and return borrowed supplies within one week. Keep your own participation note in HALO.' },
    ], bring: 'Confirm supply pickup, supervision and the organizer\'s safety instructions.', followup: 'Record the actual area covered, time given and any organizer-requested report. Do not handle hazardous waste or enter traffic.',
  },
  {
    id: 'riverkeeper', title: 'Help care for local waterways', organizer: 'Catawba Riverkeeper', interest: 'Cleanup', scopes: ['charlotte', 'basin'], area: 'Catawba-Wateree River Basin, NC and SC',
    mission: 'A nonprofit working on water stewardship across the river basin.', work: 'Public cleanups, volunteer-led cleanups, trained community-science roles and behind-the-scenes support.',
    url: 'https://www.catawbariverkeeper.org/volunteer', sourceTitle: 'Riverkeeper participation and registration', extraSources: [{ title: 'Official locations', url: 'https://www.catawbariverkeeper.org/our-locations' }],
    address: '117 Center Street, Cramerton, NC 28032', addressRole: 'Headquarters at Confluence, not an event meeting point.', contact: 'info@catawbariverkeeper.org · 704-679-9494',
    effort: 'Public cleanups are described as 2 to 3 hours. Other roles vary.', age: 'Public cleanups recommend age 12 or older. Under 18 requires an accompanying adult.', cost: 'Public cleanup supplies are included. Other costs are not specified.', access: 'Confirm the selected site and physical demands; office support is a separate option.',
    steps: [
      { title: 'Choose a role', text: 'Use the official volunteer page. Water sampling and restoration require the program\'s guidance, not a solo HALO challenge.' },
      { title: 'Check and register', text: 'Open the linked CERVIS portal for current opportunities. Recheck the place, date, requirements and availability.' },
      { title: 'Follow the organizer', text: 'Attend only at the confirmed meeting point and follow the event guidance. Do not substitute the headquarters address.' },
      { title: 'Plan what comes next', text: 'Record your participation, then ask the organizer about another suitable role.' },
    ], bring: 'Confirm clothing, water, footwear and weather instructions for the selected activity.', followup: 'For your own group cleanup, ask Riverkeeper about instructions and supplies before planning it.',
  },
  {
    id: 'trees-charlotte', title: 'Plant and care for trees together', organizer: 'TreesCharlotte', interest: 'Trees & habitat', scopes: ['charlotte'], area: 'Charlotte planting sites',
    mission: 'A local nonprofit engaging people in planting and caring for Charlotte\'s tree canopy.', work: 'Tree planting, seedling preparation, stewardship and community engagement.',
    url: 'https://treescharlotte.org/volunteer/volunteer-registration/', sourceTitle: 'TreesCharlotte volunteer guide',
    address: 'P.O. Box 32367, Charlotte, NC 28232', addressRole: 'Mailing address only. Get the actual event site from the organizer.', contact: 'info@treescharlotte.org · 704-999-0671',
    effort: 'Planting events are usually Saturday mornings. Check the chosen event.', age: 'Children may attend plantings with adult supervision.', cost: 'Planting tools, water and snacks are described as provided. Confirm other costs.', access: 'Planting involves outdoor work. Ask about terrain and alternative tasks.',
    steps: [
      { title: 'Find a volunteer role', text: 'Open the events calendar linked from the volunteer guide. Blue ribbons identify volunteer-needed events.' },
      { title: 'Confirm your place', text: 'Read that event\'s details and follow its registration instructions. Check the site, timing and weather notices.' },
      { title: 'Learn at check-in', text: 'The planting guide describes assigned zones and TreeMaster instruction. Follow their tree placement and care directions.' },
      { title: 'Continue the care', text: 'Record what you did and ask whether a stewardship role is available.' },
    ], bring: 'Work gloves, long pants and closed-toe shoes suited to digging. Recheck event instructions.', followup: 'A tree planted is a tangible output, not proof of a calculated carbon or health benefit.',
  },
  {
    id: 'mecklenburg-gardens', title: 'Help a community garden grow', organizer: 'Mecklenburg County Park and Recreation', interest: 'Gardening', scopes: ['charlotte'], area: 'Mecklenburg County community gardens',
    mission: 'The county supports shared garden spaces and volunteer participation.', work: 'Find a garden workday or ask about an appropriate volunteer role. A personal plot application is a different commitment.',
    url: 'https://parkandrec.mecknc.gov/Places-to-Visit/Parks/community-gardens', sourceTitle: 'County garden program, locations and volunteer link', extraSources: [{ title: 'County volunteer guidance', url: 'https://parkandrec.mecknc.gov/Activities/volunteer-opportunities' }],
    address: '3207 Amay James Avenue, Charlotte, NC 28208', addressRole: 'Reid Park garden location from the county list. No workday or arrival time is promised.',
    effort: 'Workday duration depends on the listing. A plot requires year-round care.', age: 'Depends on the selected role; confirm before signing up.', cost: 'Volunteer costs are not specified. Plot fees are a separate question.', access: 'Ask about paths, restrooms, lifting and an adapted role. Access is not verified here.',
    steps: [
      { title: 'Choose helping, not a plot', text: 'Use Volunteer at Our Community Gardens on the county page to find organizer-listed work.' },
      { title: 'Read the actual listing', text: 'Confirm age, equipment, accessibility, weather policy and the meeting address with that organizer.' },
      { title: 'Follow garden instructions', text: 'Only do the agreed work. Planting or other projects outside a garden fence need county approval.' },
      { title: 'Record and revisit', text: 'Keep the work you actually completed, then ask about the next appropriate task.' },
    ], bring: 'Follow the selected workday\'s clothing and equipment instructions. Do not assume tools or facilities are available.', followup: 'The county does not accept court-ordered community-service placements. Confirm school or service-credit rules separately.',
  },
  {
    id: 'union-gardener', title: 'Share practical gardening knowledge', organizer: 'N.C. Cooperative Extension, Union County Center', interest: 'Community learning', scopes: ['union'], area: 'Union County, North Carolina',
    mission: 'Extension Master Gardener volunteers support research-based community gardening education.', work: 'A trained volunteer route, with teaching gardens and public educational programs as ways to learn first.',
    url: 'https://union.ces.ncsu.edu/about-union-county-extension-master-gardeners/', sourceTitle: 'Union County gardening programs', extraSources: [{ title: 'Training and participation requirements', url: 'https://union.ces.ncsu.edu/news/frequently-asked-questions-union-county-extension-master-gardener-program/' }],
    address: '3230-D Presson Rd, Monroe, NC 28112', addressRole: 'Union County Center office address. Confirm the location of any class or activity.', contact: '704-283-3801',
    effort: 'Training and a 50-hour internship, followed by ongoing service and education requirements.', age: 'No general age requirement supplied here. Ask the center.', cost: 'Training has a fee. The linked FAQ was updated in 2024; confirm current fees and intake.', access: 'Ask about class formats, site access and suitable roles.',
    steps: [
      { title: 'Learn before committing', text: 'Read the program overview and ask the center about an information session or public gardening program.' },
      { title: 'Check the training route', text: 'The volunteer route requires an application, acceptance, training and internship. It is not a drop-in garden workday.' },
      { title: 'Confirm current requirements', text: 'Ask about the next intake, fees and schedule before adding a date to My Week.' },
      { title: 'Share what you learn', text: 'Follow the program\'s requirements, then record your own service and learning.' },
    ], bring: 'Questions about your availability, interests and the training commitment.', followup: 'You can use public programs to learn without claiming to be a certified volunteer.',
  },
];

/** Exact curated area labels only. An unknown place never produces fabricated local matches. */
export function localResourceScope(area: { place: string; state: string }): LocalResourceScope {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const place = normalize(area.place); const state = normalize(area.state);
  if (!place && !state) return 'examples';
  if (!['nc', 'north carolina'].includes(state)) return 'elsewhere';
  if (['charlotte', 'mecklenburg', 'mecklenburg county', 'charlotte, nc', '28206', '28208', '28216', '28213', '28214', '28205', '28212', '28217'].includes(place)) return 'charlotte';
  if (['union', 'union county', 'monroe'].includes(place)) return 'union';
  return 'elsewhere';
}

export function filterLocalResources(scope: LocalResourceScope, interest = 'All interests', search = '') {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return localParticipationResources.filter(resource => scope !== 'elsewhere'
    && (scope === 'examples' || resource.scopes.includes(scope))
    && (interest === 'All interests' || resource.interest === interest)
    && terms.every(term => `${resource.title} ${resource.organizer} ${resource.area} ${resource.work}`.toLowerCase().includes(term)));
}
