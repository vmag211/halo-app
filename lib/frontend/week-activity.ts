import type { PreviewAction } from './expanded-preview';
import { findProjectGuide, projectActionKey, type ProjectGuide } from './explore-project-guides';
import { safePublicLink, type Engagement, type ProjectRecord } from './explore-workspace';
import type { ExplorePhotoScene } from './explore-photos';
import type { HomeAsset } from './home-maintenance-preview';
import type { TestRecord } from './home-test-preview';
import type { WeekMeta } from './week-preview';
import {validProjectGuide} from './production/explore-service';

export type WeekActivityCollections = Record<string, readonly unknown[]>;
export type WeekActivityRoute = { tab: string; destination: string; view: string; id: string };
export type WeekActivity = {
  kind: 'project' | 'volunteering' | 'routine' | 'test' | 'note' | 'outreach' | 'generic';
  label: string; subtitle: string; image?: ExplorePhotoScene; recordHref?: WeekActivityRoute;
  fields: { label: string; value: string }[]; preparation?: string; instructions?: string[];
  sourceLinks?: { title: string; url: string }[]; milestones?: { label: string; done: boolean }[];
  guide?: ProjectGuide; project?: ProjectRecord; stepIndex?: number; completed?: number;
  currentAction?: PreviewAction; missingRecord?: boolean;
};
export type WeekProgressEntry = WeekActivity & { id: string; title: string; status: string };

function records<T>(collections: WeekActivityCollections, key: string): T[] {
  return Array.isArray(collections[key]) ? collections[key].filter(item => item && typeof item === 'object') as T[] : [];
}
const field = (label: string, value: unknown) => typeof value === 'string' && value.trim() ? [{ label, value }] : [];
const route = (tab: string, destination: string, id: string, view = 'detail'): WeekActivityRoute => ({ tab, destination, id, view });
const missing = (label: string): WeekActivity => ({ kind: 'generic', label, subtitle: 'Original record is not available', fields: [], missingRecord: true });

/** Progress is derived exclusively from the existing canonical step actions. */
export function canonicalProjectKey(guide:ProjectGuide,index:number,project?:ProjectRecord){return project?.guideId&&validProjectGuide(guide)?`explore:project:${project.id}:step:${guide.steps[index]?.id??''}`:projectActionKey(guide.id,index);}
export function ownedProjectGuide(project:ProjectRecord|undefined){return project?.guideId?validProjectGuide(project.guide)&&project.guide.id===project.guideId&&project.guide.version===project.guideVersion?project.guide:undefined:project?findProjectGuide(project.id):undefined;}
export function projectStepProgress(guide: ProjectGuide, actions: PreviewAction[],project?:ProjectRecord) {
  const completed = guide.steps.filter((_, index) => actions.some(action => action.key === canonicalProjectKey(guide,index,project) && action.state === 'completed')).length;
  const nextStep = guide.steps.findIndex((_, index) => !actions.some(action => action.key === canonicalProjectKey(guide,index,project) && action.state === 'completed'));
  const index = nextStep < 0 ? guide.steps.length - 1 : nextStep;
  return { completed, nextStep: index, allStepsComplete: nextStep < 0, currentAction: nextStep < 0 ? undefined : actions.find(action => action.key === canonicalProjectKey(guide,index,project)) };
}

/** Resolve by exact origin ID, never by a similar title or a sample fallback. */
export function resolveWeekActivity(action: PreviewAction, collections: WeekActivityCollections, actions: PreviewAction[] = []): WeekActivity {
  const projectMatch = action.key.match(/^(?:explore:)?project:([^:]+)(?::step:([^:]+))?$/);
  if (projectMatch) {
    const project = records<ProjectRecord>(collections, 'exploreProjects').find(item => item.id === projectMatch[1]);
    const guide = project?ownedProjectGuide(project):findProjectGuide(projectMatch[1]);
    if (!guide) return missing('Project');
    const explicit = projectMatch[2] === undefined ? undefined : project?.guideId&&validProjectGuide(guide)?guide.steps.findIndex(step=>step.id===projectMatch[2]):Number(projectMatch[2]);
    if (explicit !== undefined && (!Number.isInteger(explicit)||explicit<0||explicit>=guide.steps.length)) return missing('Project step');
    const progress = projectStepProgress(guide, actions,project);
    const stepIndex = explicit ?? progress.nextStep;
    const step = guide.steps[stepIndex];
    return {
      kind: 'project', label: 'Project', subtitle: explicit !== undefined ? `Step ${stepIndex + 1} · ${guide.title}` : project?.status ?? 'Workspace not started',
      image: guide.scene, recordHref: route('act', 'projects', project?.id??guide.id), guide, project, stepIndex, completed: progress.completed,
      currentAction: actions.find(item => item.key === canonicalProjectKey(guide,stepIndex,project)),
      fields: [{ label: 'Workspace', value: project?.status ?? 'Not started' }, { label: 'Recorded steps', value: `${progress.completed} of ${guide.steps.length}` }],
      preparation: guide.constraints[0], instructions: step.instructions,
      sourceLinks: guide.sources.filter(source => step.sourceIds.includes(source.id)).map(source => ({ title: source.publisher, url: source.url })),
    };
  }
  const engagementMatch = action.key.match(/^explore:commitment:(.+?)(?::followup)?$/);
  if (engagementMatch) {
    const record = records<Engagement>(collections, 'exploreEngagements').find(item => item.id === engagementMatch[1]);
    if (!record) return missing('Community activity');
    const url = safePublicLink(record.url);
    return {
      kind: 'volunteering', label: 'Community', subtitle: record.organizer || 'Organizer not supplied', recordHref: route('act', 'opportunities', record.id),
      fields: [...field('Organizer', record.organizer), ...field('Your chosen date', record.date), ...field('Meeting place', record.place), { label: 'Your status', value: record.status }],
      preparation: record.preparation, sourceLinks: url ? [{ title: 'Organizer website', url }] : [],
    };
  }
  if (action.key.startsWith('home:')) {
    const id = action.key.slice(5);
    const test = records<TestRecord>(collections, 'tests').find(item => item.id === id);
    if (test) {
      const milestones = [{ label: 'Arranged', done: test.arrangedByUser === true || test.status === 'arranged' }, { label: 'Collected', done: Boolean(test.collectionStart) }, { label: 'Result entered', done: Array.isArray(test.rows) && test.rows.length > 0 }];
      const received = milestones[2].done;
      return {
        kind: 'test', label: 'Test follow-up', subtitle: received ? 'Results entered by you' : test.status === 'awaiting' ? 'Awaiting result' : 'Test record', recordHref: route('home', 'tests', id), milestones,
        fields: [...field('Provider', test.provider), ...(!received ? field('Expected result', test.expectedDate) : []), ...field('Sample location', test.sampleLabel)],
        preparation: received ? test.review === 'user_confirmed' ? 'Transcription checked by you, not independently verified.' : 'Review the original report and any unclear values.' : 'An expected date is your record, not a laboratory delivery guarantee.',
      };
    }
    const asset = records<HomeAsset>(collections, 'assets').find(item => item.id === id);
    if (asset) return { kind: 'routine', label: 'Home care', subtitle: asset.model || 'Your home routine', recordHref: route('home', 'maintenance', id), fields: [...field('Equipment', asset.model), { label: 'Routine status', value: asset.status }, ...field('Last recorded care', asset.lastCompleted), ...field('Next routine date', asset.snoozedUntil || asset.nextDue)], preparation: asset.instructions || 'Product instructions have not been supplied.' };
    const observations = records<{ id: string; room?: string; observedAt?: string; note?: string }>(collections, 'observations').find(item => item.id === id);
    if (observations) return { kind: 'note', label: 'Home observation', subtitle: observations.room || 'Your observation', recordHref: route('home', 'maintenance', id, 'observation-detail'), fields: [...field('Observed', observations.observedAt), ...field('Room', observations.room)], preparation: observations.note };
    const garden = records<{ id: string; title: string; setup?: string; irrigation?: string; questions?: string }>(collections, 'gardens').find(item => item.id === id);
    if (garden) return { kind: 'note', label: 'Garden follow-up', subtitle: garden.title, recordHref: route('home', 'food', id, 'garden-detail'), fields: [...field('Growing space', garden.setup), ...field('Irrigation', garden.irrigation)], preparation: garden.questions };
    return missing('Home follow-up');
  }
  const noteMatch = action.key.match(/^explore:note:(.+)$/);
  if (noteMatch) {
    const note = records<{ id: string; title: string; noteType?: string; description?: string; observedAt?: string }>(collections, 'exploreNotes').find(item => item.id === noteMatch[1]);
    if (!note) return missing('Note follow-up');
    return { kind: 'note', label: 'Note follow-up', subtitle: note.title, recordHref: route('act', 'observations', note.id), fields: [...field('Note type', note.noteType), ...field('Recorded date', note.observedAt)], preparation: note.description };
  }
  if (action.key.startsWith('explore:outreach:')) return { kind: 'outreach', label: 'Outreach', subtitle: 'Your conversation follow-up', recordHref: route('act', 'outreach', '', 'list'), fields: [] };
  const outcomeMatch = action.key.match(/^explore:followthrough:(.+)$/);
  if (outcomeMatch) {
    const record = records<{ id: string; status: string; nextStep?: string }>(collections, 'exploreOutcomes').find(item => item.id === outcomeMatch[1]);
    if (!record) return missing('Follow-up');
    const id = record.id;
    const origin = id.startsWith('note-case:') ? route('act', 'observations', id.slice(10)) : id.startsWith('project-review:') ? route('act', 'projects', id.slice(15)) : route('act', 'outreach', '', 'list');
    return { kind: id.startsWith('note-case:') ? 'note' : 'outreach', label: 'Follow-up', subtitle: record.status, recordHref: origin, fields: [], preparation: record.nextStep };
  }
  return { kind: 'generic', label: 'Your task', subtitle: action.origin, fields: [] };
}

export function weekActivityHref(activity: Pick<WeekActivity, 'recordHref'>, href: (tab: string, destination?: string) => string): string | undefined {
  const record = activity.recordHref;
  if (!record) return undefined;
  const base = href(record.tab, record.destination);
  if (!record.id) return base;
  return record.tab === 'home' ? `${base}&homeView=${record.view}&record=${encodeURIComponent(record.id)}` : `${base}&exploreView=${record.view}&exploreRecord=${encodeURIComponent(record.id)}`;
}

/** Owned active work only. No example projects, calendar copies or completion guesses. */
export function weekProgressEntries(collections: WeekActivityCollections, actions: PreviewAction[], metas: Record<string, WeekMeta> = {}): WeekProgressEntry[] {
  const entries: WeekProgressEntry[] = [];
  for (const project of records<ProjectRecord>(collections, 'exploreProjects').filter(item => item.status !== 'Completed')) {
    const guide = ownedProjectGuide(project);
    if (!guide) { entries.push({ id: `project:${project.id}`, title: project.title, status: project.status, kind: 'project', label: 'Project', subtitle: 'Guide unavailable', fields: [], recordHref: route('act', 'projects', project.id) }); continue; }
    const progress = projectStepProgress(guide, actions,project);
    const task = progress.currentAction;
    const status = project.status === 'Paused' ? 'Paused' : task && metas[task.key]?.archived ? 'Step archived' : task && metas[task.key]?.paused ? 'Step paused' : progress.allStepsComplete ? 'Ready for your result' : 'Active';
    entries.push({ id: `project:${project.id}`, title: project.title, status, kind: 'project', label: 'Project', subtitle: progress.allStepsComplete ? 'Record what you achieved' : guide.steps[progress.nextStep].title, image: guide.scene, recordHref: route('act', 'projects', project.id), fields: [], guide, project, stepIndex: progress.nextStep, completed: progress.completed, currentAction: task });
  }
  for (const engagement of records<Engagement>(collections, 'exploreEngagements').filter(item => item.status !== 'Closed')) {
    const action = actions.find(item => item.key === `explore:commitment:${engagement.id}`);
    const context = resolveWeekActivity(action ?? { id: '', key: `explore:commitment:${engagement.id}`, title: engagement.title, origin: 'Explore', reason: '', date: engagement.date, state: 'saved' }, collections, actions);
    entries.push({ ...context, id: `engagement:${engagement.id}`, title: engagement.title, status: engagement.status, subtitle: engagement.status === 'Participated' ? 'Keep your result or choose a follow-up' : engagement.preparation ? 'Review your preparation' : 'Review the organizer’s next step' });
  }
  for (const test of records<TestRecord>(collections, 'tests').filter(item => !item.archived && ['draft', 'arranged', 'sampled', 'awaiting', 'followup'].includes(item.status))) {
    const context = resolveWeekActivity({ id: '', key: `home:${test.id}`, title: test.title, origin: 'Homeguard', reason: '', date: '', state: 'saved' }, collections, actions);
    entries.push({ ...context, id: `test:${test.id}`, title: test.title, status: context.subtitle, subtitle: test.rows?.length ? 'Review the recorded result' : test.expectedDate ? `Expected ${test.expectedDate}` : test.collectionStart ? 'Keep track of the result' : 'Continue your test plan' });
  }
  return entries;
}
