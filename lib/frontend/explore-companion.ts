import type { FieldNote } from './explore-preview';

export type NoteSelection = { id: string; revision: number };
export function noteSelectionIsCurrent(records: readonly Pick<FieldNote, 'id' | 'revision'>[], selected: readonly NoteSelection[]) {
  return selected.length > 0 && new Set(selected.map(item => item.id)).size === selected.length && selected.every(item => records.some(record => record.id === item.id && record.revision === item.revision));
}
export function companionIntent(request: string): 'projects' | 'delete' | 'guide' {
  if (/\b(delete|remove|erase)\b/i.test(request)) return 'delete';
  if (/\b(step|guide|explain|how|materials)\b/i.test(request) && !/\b(ideas|suggest|find)\b/i.test(request)) return 'guide';
  return 'projects';
}
/** Narrow, transparent matching against a reviewed catalogue. Never executes text. */
export function suggestedProjectKinds(text: string) {
  const result: string[] = [];
  if (/bee|nest/i.test(text)) result.push('bee');
  if (/pollinat|native|tree|garden|plant|flower/i.test(text)) result.push('native');
  if (/litter|cleanup|clean up|trash|creek|community/i.test(text)) result.push('cleanup');
  if (/solar|energy|oven|sun/i.test(text)) result.push('solar');
  return result.length ? [...new Set(result)] : ['native', 'cleanup', 'solar'];
}
