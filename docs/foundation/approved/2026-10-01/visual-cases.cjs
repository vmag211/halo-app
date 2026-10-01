// Approved Site version 8 coverage. Changes require a separate approval archive.
const base = '/foundation/preview/';
const factors = ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead'];
const members = ['toddler', 'child', 'teen', 'adult', 'senior', 'pregnant', 'respiratory'];
const cases = [
  { id: 'today', path: base, tab: 'today' },
  { id: 'homeguard', path: base, tab: 'home' },
  ...factors.map(factor => ({ id: `factor-${factor}`, path: `${base}factor/${factor}/` })),
  { id: 'today-family', path: `${base}family/` },
  ...members.map(member => ({ id: `homeguard-${member}`, path: `${base}household/${member}/` })),
  ...['today', 'home'].flatMap(tab => ['no-data', 'partial', 'offline', 'score-zero', 'contribution-zero'].map(scenario => ({ id: `${tab === 'home' ? 'homeguard' : tab}-${scenario}`, path: base, tab, scenario }))),
  ...['today', 'home'].flatMap(tab => ['initial', 'conversation'].map(luna => ({ id: `luna-${tab}-${luna}`, path: base, tab, luna }))),
  { id: 'luna-offline', path: base, tab: 'today', scenario: 'offline', luna: 'initial' },
  { id: 'luna-missing', path: base, tab: 'today', scenario: 'no-data', luna: 'conversation' },
];
module.exports = { cases, widths: [320, 375], appearances: ['light', 'dark'], fixedTime: '2026-10-01T16:00:00.000Z', viewportHeight: 850 };
