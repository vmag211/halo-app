import { actionDraftError, validActionDate, type PreviewAction } from './expanded-preview';

export type LunaIntent =
  | { kind: 'projects'; request: string }
  | { kind: 'local'; request: string }
  | { kind: 'guide' }
  | { kind: 'answer'; theme: 'water' | 'home' | 'today' | 'reason' }
  | { kind: 'start-project'; name: string }
  | { kind: 'open-project'; name: string }
  | { kind: 'navigate'; tab: string; destination?: string }
  | { kind: 'create-task'; title: string; date: string; requiresDate: boolean }
  | { kind: 'move-task'; date: string; requiresDate: boolean }
  | { kind: 'save-note'; title: string; description: string }
  | { kind: 'delete-note'; name: string }
  | { kind: 'clarify'; message: string };

export function explicitLunaDate(text: string): { date: string; invalid: boolean; requiresDate: boolean } {
  const dates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const relative = /\b(today|tomorrow|tonight|next week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text);
  return { date: dates[0] ?? '', invalid: dates.length > 1 || Boolean(dates[0] && !validActionDate(dates[0])), requiresDate: Boolean(dates.length || relative) };
}

export function lunaCalendarAnchor(instant = new Date(), timezone = 'America/New_York'): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`;
}

/** Date-only arithmetic. The reviewed date remains editable and never creates a timed reminder. */
export function resolveLunaCalendarDate(text: string, options: { anchor: string; timezone: string; referenceDate?: string }): { date: string; requiresDate: boolean; explanation: string; ambiguous?: string } {
  const explicit = explicitLunaDate(text);
  if (explicit.invalid || !validActionDate(options.anchor) || !options.anchor) return { date: '', requiresDate: true, explanation: '', ambiguous: 'Choose one valid calendar date.' };
  if (explicit.date && /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b/i.test(text)) return { date: '', requiresDate: true, explanation: '', ambiguous: 'Choose an all-day date below. You can add a time in My Week.' };
  if (explicit.date) return { date: explicit.date, requiresDate: true, explanation: `All-day date in ${options.timezone}.` };
  if (/\b(tonight|weekend|next week)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b/i.test(text)) return { date: '', requiresDate: true, explanation: '', ambiguous: 'Which date do you mean? You can add a time in My Week.' };
  const add = (day: string, amount: number) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); };
  if (/\btomorrow\b/i.test(text)) return { date: add(options.anchor, 1), requiresDate: true, explanation: `Tomorrow, based on ${options.anchor} in ${options.timezone}.` };
  if (/\btoday\b/i.test(text)) return { date: options.anchor, requiresDate: true, explanation: `Today in ${options.timezone}.` };
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const matches = text.toLowerCase().match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g) ?? [];
  if (matches.length !== 1) return { date: '', requiresDate: Boolean(matches.length), explanation: '', ...(matches.length ? { ambiguous: 'Choose one calendar date for this task.' } : {}) };
  if (/\bnext\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(text)) return { date: '', requiresDate: true, explanation: '', ambiguous: 'Which date do you mean by next? Choose it below so I use the right week.' };
  const target = weekdays.indexOf(matches[0]);
  const reference = options.referenceDate && validActionDate(options.referenceDate) ? options.referenceDate : options.anchor;
  const current = new Date(`${reference}T12:00:00Z`).getUTCDay();
  const sameWeek = Boolean(options.referenceDate) || /\bthis\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(text);
  const delta = sameWeek ? (target + 6) % 7 - (current + 6) % 7 : (target - current + 7) % 7;
  const date = add(reference, delta);
  if (!options.referenceDate && sameWeek && date < options.anchor) return { date: '', requiresDate: true, explanation: '', ambiguous: 'That weekday has passed in this calendar week. Which date should I use?' };
  return { date, requiresDate: true, explanation: options.referenceDate ? `${matches[0]} in the existing task's Monday-to-Sunday week (${reference}), ${options.timezone}.` : `${matches[0]}, based on ${options.anchor} in ${options.timezone}.` };
}

/** Limited wireframe grammar. Only the user's current message is an instruction. */
export function lunaIntent(value: string): LunaIntent {
  const text = value.trim().replace(/\u2014/g, ',');
  if (!text) return { kind: 'clarify', message: 'Tell me what you would like to do.' };
  const note = text.match(/^(?:please\s+)?(?:save|add|create|record|remember)\s+(?:this\s+|a\s+|an\s+)?(?:note|thought|idea)\s*[:,-]?\s+([\s\S]+)$/i);
  if (note) return { kind: 'save-note', title: note[1].split(/[.!?\n]/)[0].slice(0, 100).trim(), description: note[1].trim() };
  if (/\b(don['’]?t|do not|never|cancel)\b.*\b(delete|remove|erase|save|create|add|schedule|move)\b/i.test(text)) return { kind: 'clarify', message: 'I have not changed anything. What would you like to keep or work on instead?' };
  if (/\b(what|why|explain|mean|understand)\b/i.test(text)) {
    if (/\bwhy\b.*\b(project|suggest|recommend|this)\b/i.test(text)) return { kind: 'answer', theme: 'reason' };
    if (/\b(water|pfas|pfos|pfoa)\b/i.test(text)) return { kind: 'answer', theme: 'water' };
    if (/\b(focus|prioriti|at home|homeguard)\b/i.test(text)) return { kind: 'answer', theme: 'home' };
    if (/\b(what can i do today|today|air quality|aqi)\b/i.test(text)) return { kind: 'answer', theme: 'today' };
  }
  if (/^(?:please\s+)?(?:start|begin)\b/i.test(text)) return { kind: 'start-project', name: text.replace(/^(?:please\s+)?(?:start|begin)\s+(?:(?:a|the|my|this)\s+)?(?:project\s*)?[:,-]?\s*/i, '').replace(/\s+(?:on|for)\s+(?:\d{4}-\d{2}-\d{2}|today|tomorrow|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b.*$/i, '').trim() };
  if (/\b(delete|remove|erase)\b/i.test(text)) {
    if (!/\bnotes?\b/i.test(text)) return { kind: 'clarify', message: 'Which note should I remove? I will ask you to confirm first.' };
    const name = text.replace(/^(?:please\s+)?(?:delete|remove|erase)\s+/i, '').replace(/^(?:my|the|a)\s+/i, '').replace(/^(?:note(?:\s+(?:called|named|titled))?)\s*[:,-]?\s*/i, '').replace(/\s+note$/i, '').replace(/^["“']|["”']$/g, '').trim();
    return { kind: 'delete-note', name: /^(all|some|my|notes?|these|selected|those)(?:\s+notes?)?$/i.test(name) ? '' : name };
  }
  const date = explicitLunaDate(text);
  if (date.invalid) return { kind: 'clarify', message: 'Use one valid all-day date in YYYY-MM-DD form, or choose it in the review. I have not changed anything.' };
  if (/\b(move|reschedule)\b/i.test(text) && /\b(task|that|it|reminder|last|date|to)\b/i.test(text)) return { kind: 'move-task', date: date.date, requiresDate: true };
  const task = text.match(/^(?:please\s+)?(?:(?:add|create|save|schedule)\s+(?:(?:a|this|the)\s+)?(?:task|reminder|action)\s*[:,-]?\s*|remind me to\s+)([\s\S]+)$/i);
  if (task) {
    const title = task[1].replace(/\s+(?:on|for|by|at)\s+(?:\d{4}-\d{2}-\d{2}|today|tomorrow|tonight|next week|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b.*$/i, '').trim();
    return title ? { kind: 'create-task', title: title.slice(0, 160), date: date.date, requiresDate: date.requiresDate } : { kind: 'clarify', message: 'What should the task say? Tell me the work you want to remember.' };
  }
  if (/\b(open|show|take me|go to)\b/i.test(text)) {
    if (/\bmap\b/i.test(text)) return { kind: 'navigate', tab: 'map' };
    if (/\btests?|reports?|records?\b/i.test(text)) return { kind: 'navigate', tab: 'home', destination: 'tests' };
    if (/\bmy week|tasks?|agenda\b/i.test(text)) return { kind: 'navigate', tab: 'plan' };
    if (/\bnotes?|notebook\b/i.test(text)) return { kind: 'navigate', tab: 'act', destination: 'observations' };
    if (/\bproject\b/i.test(text) || /\b(solar|bee|native|pollinator)\b/i.test(text)) return { kind: 'open-project', name: text.replace(/^(?:please\s+)?(?:open|show|take me to|go to)\s+(?:(?:a|the|my|this)\s+)?(?:project\s*)?[:,-]?\s*/i, '').trim() };
  }
  if (/\b(guide|walk me|next step|this step|how do i|help me with this)\b/i.test(text)) return { kind: 'guide' };
  if (/\b(volunteer|volunteering|organizations?|organisations?|local help|community service|join|near me|nearby)\b/i.test(text) && !/\bprojects?|ideas?\b/i.test(text)) return { kind: 'local', request: text };
  if (/\b(projects?|ideas?|suggest|recommend|garden|balcony|indoors?|backyard|solar|bees?|pollinat|cleanup|minutes|budget|alone|cheap|cheaper|free|group|under an hour|no garden|do by myself)\b/i.test(text)) return { kind: 'projects', request: text };
  return { kind: 'clarify', message: 'I can help find a project or local organization, guide the current step, open a map or test, save a task or note, or review a named note for deletion. What would you like me to do?' };
}

export function matchingLunaNotes<T extends { title: string }>(records: T[], name: string): T[] {
  if (!name.trim()) return [];
  const query = name.toLocaleLowerCase().trim();
  const exact = records.filter(record => record.title.toLocaleLowerCase() === query);
  return exact.length ? exact : records.filter(record => record.title.toLocaleLowerCase().includes(query));
}

export function matchingLunaProjects<T extends { id: string; title: string }>(records: T[], name: string): T[] {
  const normalize = (text: string) => text.toLocaleLowerCase().replace(/[-_]/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const query = normalize(name).replace(/\s+project$/, '');
  if (!query) return [];
  const exact = records.filter(record => normalize(record.title) === query || normalize(record.id) === query);
  if (exact.length) return exact;
  const words = query.split(' ').filter(word => !['the', 'a', 'an', 'my', 'project'].includes(word));
  return words.length ? records.filter(record => { const text = normalize(`${record.id} ${record.title}`); return words.every(word => text.includes(word)); }) : [];
}

export function lunaTaskRevisionMatches(action: PreviewAction | undefined, revision: number): boolean {
  return Boolean(action && (action.revision ?? 1) === revision);
}

export function lunaTaskReviewError(title: string, date: string, requiresDate: boolean): string | null {
  return requiresDate && !date ? 'Choose an exact all-day date before saving this schedule.' : actionDraftError(title, date);
}
