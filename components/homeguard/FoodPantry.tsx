'use client';

import { useState } from 'react';
import { Apple, ArrowLeft, Bookmark, Fish, Milk, NotebookPen, Pencil, Search, ShoppingBasket, Sprout, Wheat, Drumstick, Refrigerator, Snowflake, Plus, Package, type LucideIcon } from 'lucide-react';
import {
  cleanFoodNote, foodGuide, foodGuideEssentials, foodGuideReviewedAt, foodGuideRevision, foodGuideSources,
  foodOriginContext, foodOriginLabels, foodStorageLabels, foodGuides, initialPantryItems, validatePantryItem,
  type FoodGuide, type FoodOrigin, type FoodStorage, type FoodSourceKey, type PantryItem,
} from '@/lib/frontend/food-pfas-guide';
import { catalogueFood, foodCatalogue, pantryContaminants, pantryResultLabel, searchFoods, validFoodStorage, type CatalogueFood } from '@/lib/frontend/food-catalogue';
import { useHomeCollection, useHomeDraft, useHomeWorkspace } from './HomeWorkspaceState';
import { ActionButton, Confirm, DeletableRecord, DeleteButton, Empty, Field, PageIntro, RecordForm, WorkspaceLink, type WorkspaceProps } from './HomeWorkspaceUI';
import { FoodDetails, FoodSourceLink } from './FoodShared';
import { PublishedFoodEvidence } from './PublishedFoodEvidence';
import { FoodThumb } from './FoodVisuals';
import './food-pantry.css';

const icons: Record<FoodGuide['icon'], LucideIcon> = { fish: Fish, produce: Apple, dairy: Milk, meat: Drumstick, pantry: Wheat };
function GuideSource({ source }: { source: FoodSourceKey }) {
  return <FoodSourceLink href={foodGuideSources[source].url}>{foodGuideSources[source].title}</FoodSourceLink>;
}
function BackToFoods({ navigate }: Pick<WorkspaceProps, 'navigate'>) {
  return <button className="hg-text-button" type="button" onClick={() => navigate('pantry')}><ArrowLeft size={16} aria-hidden="true" />Food at home</button>;
}

export function FoodPantry(props: WorkspaceProps) {
  if (props.view === 'pantry-custom') return <AddKitchenFood {...props} />;
  if (props.view === 'pantry-add') {
    const food = catalogueFood(props.recordId);
    return food ? <AddKitchenFood key={food.id} {...props} food={food} /> : <Empty title="This food is unavailable" action={<BackToFoods navigate={props.navigate} />}><p>Search the catalogue to choose a food.</p></Empty>;
  }
  if (props.view === 'pantry-detail') {
    const guide = foodGuide(props.recordId);
    return guide ? <FoodGuideDetail key={guide.id} {...props} guide={guide} /> : <Empty title="This food guide is unavailable" action={<BackToFoods navigate={props.navigate} />}><p>Choose a food group to see the available guidance.</p></Empty>;
  }
  if (props.view === 'pantry-note' || props.view === 'pantry-edit') return <SavedFoodNote {...props} />;
  return <FoodPantryOverview {...props} />;
}

function FoodPantryOverview({ navigate, view }: WorkspaceProps) {
  const [search, setSearch] = useHomeDraft('pantry-search', '');
  const [shown, setShown] = useState(12);
  const notes = useHomeCollection<PantryItem>('pantryItems', initialPantryItems);
  const matches = searchFoods(search);
  const savedOnly = view === 'pantry-saved';
  return <div className="hg-stack hg-pantry">
    <PageIntro eyebrow="FOOD · PFAS & LEAD" title={savedOnly ? 'Your kitchen' : 'Food at home'} description="Keep your foods together. Understand the evidence, then choose what to follow up." icon={<ShoppingBasket />} />
    <div className="hg-segmented" aria-label="Food at home view"><button type="button" aria-pressed={!savedOnly} onClick={() => navigate('pantry')}>Find a food</button><button type="button" aria-pressed={savedOnly} onClick={() => navigate('pantry-saved')}>Your kitchen{notes.records.length > 0 ? ` (${notes.records.length})` : ''}</button></div>
    <KitchenShelf items={notes.records.filter(item => item.storage)} navigate={navigate} remove={notes.remove} />
    <p className="hg-meta hg-kitchen-session">Storage labels help organize your kitchen. They are not storage advice.</p>
    {!savedOnly ? <>
      <p className="hg-guidance-boundary">{foodGuideEssentials.boundary}</p>
      <section className="hg-card hg-food-search"><Field label="Find a food"><span className="hg-search"><Search size={18} aria-hidden="true" /><input type="search" autoComplete="off" placeholder="Try salmon, milk or spinach" value={search} onChange={event => { setSearch(event.target.value); setShown(12); }} /></span></Field><span className="hg-meta" role="status">{matches.length} matching {matches.length === 1 ? 'food' : 'foods'} · {foodCatalogue.length} common foods</span></section>
      <button className="hg-food-custom-link" type="button" onClick={() => navigate('pantry-custom')}>Add a food of your own<Plus size={19} aria-hidden="true" /></button>
      <div className="hg-food-catalogue hg-individual-foods">{matches.slice(0, shown).map(food => <button className="hg-food-pick" type="button" key={food.id} onClick={() => navigate('pantry-add', food.id)}><FoodThumb foodId={food.id} guideId={food.guideId} /><span className="hg-food-name">{food.name}</span><Plus aria-hidden="true" size={17} /></button>)}</div>
      {matches.length > shown && <button className="hg-button-secondary" type="button" onClick={() => setShown(shown + 24)}>Show more foods</button>}
      {matches.length === 0 && <Empty title="Food not listed yet"><p>Add it with the option above, or try another name. Missing from the catalogue does not mean free of PFAS or lead.</p><button className="hg-button-secondary" type="button" onClick={() => { setSearch(''); setShown(12); }}>Clear food search</button></Empty>}
      <FoodDetails title="Food group guides"><div className="hg-food-catalogue hg-food-groups">{foodGuides.map(guide => { const Icon = icons[guide.icon]; return <WorkspaceLink key={guide.id} icon={<Icon />} title={guide.title} detail={guide.examples} onClick={() => navigate('pantry-detail', guide.id)} />; })}</div></FoodDetails>
      <section className="hg-insight"><span className="hg-kicker">KEEP THE BIG PICTURE</span><h3>Variety still matters</h3><p>{foodGuideEssentials.diet}</p><GuideSource source="fdaQuestions" /></section>
      <FoodDetails title="What can this guide tell me?"><p>{foodGuideEssentials.chemicals}</p><GuideSource source="epa" /><p>{foodGuideEssentials.lead}</p><GuideSource source="fdaLead" /><p className="hg-meta">Educational sources checked {foodGuideReviewedAt}. This is not a live recall search, ingredient checker or dietary assessment.</p></FoodDetails>
    </> : <><button className="hg-button" type="button" onClick={() => navigate('pantry')}><Plus size={18} aria-hidden="true" />Add a food</button>{notes.records.filter(item => !item.storage).length > 0 ? <section className="hg-stack"><h3>Your food notes</h3>{notes.records.filter(item => !item.storage).map(item => <WorkspaceLink key={item.id} deletion={{ remove: () => notes.remove(item.id), description: 'This removes this food note. Food guides, published evidence and separately saved My Week actions are kept.' }} icon={<NotebookPen />} title={item.title} detail={`${foodOriginLabels[item.origin]} · ${foodGuide(item.guideId)?.title ?? 'Guide unavailable'}`} onClick={() => navigate('pantry-note', item.id)} />)}</section> : notes.records.length === 0 ? <Empty title="Keep a question for later"><p>Add a food to your kitchen, or save a question from a food group guide.</p></Empty> : null}</>}
    <WorkspaceLink title="Food & Garden" detail="Fish advisories, growing sites and local resources." icon={<Sprout />} onClick={() => navigate('list')} />
  </div>;
}

function FoodResultBadges({ compact = false }: { compact?: boolean }) {
  if (compact) return <span className="hg-food-levels">{pantryContaminants.map(factor => <span key={factor}><span className="hg-level-key">{factor}</span><span className="hg-level-value">{pantryResultLabel}</span></span>)}</span>;
  return <dl className="hg-food-levels">{pantryContaminants.map(factor => <div key={factor}><dt>{factor}</dt><dd>{pantryResultLabel}</dd></div>)}</dl>;
}
function KitchenShelf({ items, navigate, remove }: { items: PantryItem[]; navigate: WorkspaceProps['navigate']; remove: (id: string) => Promise<boolean> }) {
  const [storage, setStorage] = useHomeDraft<FoodStorage>('pantry-storage', 'fridge');
  const visible = items.filter(item => item.storage === storage);
  return <section className="hg-kitchen" aria-label="Virtual fridge and pantry">
    <div className="hg-kitchen-top"><span className="hg-kicker">MY KITCHEN</span><Refrigerator size={23} aria-hidden="true" /></div>
    <div className="hg-kitchen-tabs" role="group" aria-label="Kitchen storage">{Object.entries(foodStorageLabels).map(([key, label]) => { const Icon = key === 'fridge' ? Refrigerator : key === 'freezer' ? Snowflake : Package; return <button key={key} type="button" aria-pressed={storage === key} onClick={() => setStorage(key as FoodStorage)}><Icon size={17} aria-hidden="true" /><span>{label}</span><small>{items.filter(item => item.storage === key).length}</small></button>; })}</div>
    <div className="hg-kitchen-shelf" aria-label={`${foodStorageLabels[storage]} foods`}>
      {visible.length ? visible.map(item => <DeletableRecord key={item.id} title={item.title} deletion={{ remove: () => remove(item.id), description: 'This removes this food from your kitchen with its private notes. Food guides, published evidence and separately saved My Week actions are kept.' }}><button className="hg-kitchen-item" type="button" onClick={() => navigate('pantry-note', item.id)}><FoodThumb foodId={item.foodId} guideId={item.guideId} /><strong>{item.title}</strong><FoodResultBadges compact /></button></DeletableRecord>) : <div className="hg-kitchen-empty"><ShoppingBasket size={34} aria-hidden="true" /><p>Your {foodStorageLabels[storage].toLowerCase()} is ready.</p><span>Add a food below to start.</span></div>}
    </div>
    <p className="hg-meta">Your items are unmeasured. Open a food for published findings or guidance. Unknown is not a safety rating.</p>
  </section>;
}
function AddKitchenFood({ food, ...props }: WorkspaceProps & { food?: CatalogueFood }) {
  const notes = useHomeCollection<PantryItem>('pantryItems', initialPantryItems);
  const [currentStorage, setCurrentStorage] = useHomeDraft<FoodStorage>('pantry-storage', 'fridge');
  const [search] = useHomeDraft('pantry-search', '');
  const [draft, setDraft, clearDraft] = useHomeDraft(`pantry:add:${food?.id ?? 'custom'}`, { title: food?.name ?? search.slice(0, 80), guideId: food?.guideId ?? 'pantry', storage: currentStorage, origin: 'unknown' as FoodOrigin, question: '' });
  const guide = foodGuide(draft.guideId)!;
  const [error, setError] = useState('');
  const Icon = icons[guide.icon];
  return <div className="hg-stack hg-pantry"><BackToFoods navigate={props.navigate} /><PageIntro eyebrow="YOUR KITCHEN" title={food ? `Add ${food.name.toLowerCase()}` : 'Add your food'} description="Choose where to keep it. Add any other details when you need them." icon={<Icon />} />
    <section className="hg-card hg-food-add-form"><RecordForm onConfirmed={id => { setCurrentStorage(draft.storage); clearDraft(); props.navigate('pantry-note', id); }} submitLabel="Add to my kitchen" onCancel={() => props.navigate('pantry')} onSubmit={async () => {
    const values = { title: cleanFoodNote(draft.title), question: cleanFoodNote(draft.question), origin: draft.origin, guideId: guide.id, storage: draft.storage };
    const validation = validatePantryItem(values); if (validation || !validFoodStorage(draft.storage)) { setError(validation || 'Choose a storage section.'); return; }
    const now = new Date().toISOString();
    const item: PantryItem = { ...values, id: `food-item-${crypto.randomUUID()}`, revision: 0, ...(food ? { foodId: food.id } : {}), storage: draft.storage, createdAt: now, updatedAt: now, guideRevision: foodGuideRevision };
    if (await notes.save(item)) { setCurrentStorage(draft.storage); clearDraft(); props.navigate('pantry-note', item.id); }
  }}>
    {!food && <><Field label="Food name"><input required maxLength={80} autoComplete="off" placeholder="For example, garden peas" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="Food group"><select value={draft.guideId} onChange={event => setDraft({ ...draft, guideId: event.target.value, origin: 'unknown' })}>{foodGuides.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}</select></Field></>}
    <Field label="Keep in"><select aria-label="Keep in" value={draft.storage} onChange={event => setDraft({ ...draft, storage: event.target.value as FoodStorage })}>{Object.entries(foodStorageLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
    <FoodDetails title="Add details (optional)">
    {food && <><Field label="Food name"><input required maxLength={80} value={draft.title} onInvalid={event => { const field = event.currentTarget; const details = field.closest('details'); if (details) details.open = true; setError('Give this food a name.'); field.focus(); }} onChange={event => { setError(''); setDraft({ ...draft, title: event.target.value }); }} /></Field><small className="hg-meta">Your label for {food.name.toLowerCase()}. Choose a different catalogue entry to change the food type.</small></>}
    <Field label="Food origin"><select aria-label="Food origin" value={draft.origin} onChange={event => setDraft({ ...draft, origin: event.target.value as FoodOrigin })}>{guide.origins.map(value => <option key={value} value={value}>{foodOriginLabels[value]}</option>)}</select></Field>
    <Field label="Question to keep (optional)"><textarea rows={3} maxLength={500} placeholder={guide.question} value={draft.question} onChange={event => setDraft({ ...draft, question: event.target.value })} /></Field>
    </FoodDetails>
  </RecordForm>{error && <p className="hg-error" role="alert">{error}</p>}<p className="hg-meta">Your food stays unmeasured. Published evidence below is kept separate from your item.</p></section>
    <PublishedFoodEvidence key={guide.id} foodId={food?.id} guideId={guide.id} />
    </div>;
}

function FoodGuideDetail({ guide, ...props }: WorkspaceProps & { guide: FoodGuide }) {
  const [origin, setOrigin] = useHomeDraft<FoodOrigin>(`pantry-origin-${guide.id}`, 'unknown');
  const context = foodOriginContext(guide, origin);
  const Icon = icons[guide.icon];
  return <div className="hg-stack hg-pantry">
    <BackToFoods navigate={props.navigate} />
    <PageIntro eyebrow="FOOD · PFAS & LEAD" title={guide.title} description={guide.examples} icon={<Icon />} />
    <section className="hg-insight"><span className="hg-kicker">WHAT THE EVIDENCE SAYS</span><p>{guide.finding}</p><GuideSource source={guide.findingSource} /><p className="hg-meta">{foodGuideSources[guide.findingSource].scope} · Source checked {foodGuideReviewedAt}</p></section>
    <p className="hg-guidance-boundary">{guide.limit}</p>
    <FoodDetails title="What about lead?"><p>{foodGuideEssentials.lead}</p><GuideSource source="fdaLead" /><p>A food name or nearby water result cannot determine its lead level. No matching food result is available.</p></FoodDetails>
    <section className="hg-card"><h3>Where does yours come from?</h3><div className="hg-choice-chips" role="group" aria-label="Food origin">{guide.origins.map(value => <button type="button" key={value} aria-pressed={origin === value} onClick={() => setOrigin(value)}>{foodOriginLabels[value]}</button>)}</div>
      <div className="hg-origin-guidance" aria-live="polite"><h4>{context.title}</h4><p>{context.text}</p>{context.source && <GuideSource source={context.source} />}</div>
      <WorkspaceLink title={context.nextTitle} detail={context.nextDetail} onClick={() => props.navigate(context.nextView)} />
      {origin === 'caught' ? <FoodSourceLink href="https://www.epa.gov/choose-fish-and-shellfish-wisely/state-territorial-tribal-and-epa-fish-program-contacts">Find official state advisory sources</FoodSourceLink> : origin === 'store' ? <FoodSourceLink href="https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts">Open FDA recalls and safety alerts</FoodSourceLink> : null}
    </section>
    <FoodDetails title="Keep a food note"><p>Save a question to revisit. This does not test the food or send a message.</p><FoodNoteForm guide={guide} origin={origin} suggestedQuestion={context.question} onSaved={id => props.navigate('pantry-note', id)} /></FoodDetails>
    <FoodDetails title="About PFAS and this guide"><p>{foodGuideEssentials.chemicals}</p><GuideSource source="epa" /><p>{foodGuideEssentials.diet}</p><GuideSource source="fdaQuestions" /><p className="hg-meta">Published studies do not measure your food. Food notes do not change your HALO scores.</p></FoodDetails>
  </div>;
}

function FoodNoteForm({ guide, origin, suggestedQuestion, existing, onSaved, onCancel }: { guide: FoodGuide; origin: FoodOrigin; suggestedQuestion: string; existing?: PantryItem; onSaved: (id: string) => void; onCancel?: () => void }) {
  const notes = useHomeCollection<PantryItem>('pantryItems', initialPantryItems);
  const [, setCurrentStorage] = useHomeDraft<FoodStorage>('pantry-storage', 'fridge');
  const [draft, setDraft, clearDraft] = useHomeDraft(`pantry:${existing?.id ?? `${guide.id}:${origin}`}`, { title: existing?.title ?? '', question: existing?.question ?? suggestedQuestion, origin: existing?.origin ?? origin, storage: existing?.storage });
  const [error, setError] = useState('');
  return <><RecordForm onConfirmed={id => { clearDraft(); setError(''); onSaved(id); }} submitLabel={existing ? 'Save changes' : 'Save food note'} onCancel={onCancel} onSubmit={async () => {
    const values = { title: cleanFoodNote(draft.title), question: cleanFoodNote(draft.question), origin: draft.origin, guideId: guide.id, ...(existing?.storage ? { storage: draft.storage } : {}) };
    const validation = validatePantryItem(values); if (validation) { setError(validation); return; }
    const now = new Date().toISOString();
    const record: PantryItem = { ...values, id: existing?.id ?? `food-note-${crypto.randomUUID()}`, revision: existing?.revision ?? 0, createdAt: existing?.createdAt ?? now, updatedAt: now, guideRevision: foodGuideRevision, ...(existing?.foodId ? { foodId: existing.foodId, storage: draft.storage } : {}) };
    if (await notes.save(record)) { if (record.storage) setCurrentStorage(record.storage); clearDraft(); setError(''); onSaved(record.id); }
  }}>
    <Field label={existing?.storage ? 'Food name' : 'Food note name'}><input required maxLength={80} autoComplete="off" value={draft.title} placeholder={`Example ${guide.id === 'produce' ? 'garden tomatoes' : guide.id === 'seafood' ? 'weekend catch' : 'grocery item'}`} onChange={event => setDraft({ ...draft, title: event.target.value })} /></Field>
    {existing?.storage && <Field label="Keep in"><select aria-label="Keep in" value={draft.storage} onChange={event => setDraft({ ...draft, storage: event.target.value as FoodStorage })}>{Object.entries(foodStorageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>}
    <Field label="Food origin"><select aria-label="Food origin" value={draft.origin} onChange={event => setDraft({ ...draft, origin: event.target.value as FoodOrigin })}>{guide.origins.map(value => <option value={value} key={value}>{foodOriginLabels[value]}</option>)}</select></Field>
    <Field label={existing?.storage ? 'Question to keep (optional)' : 'Question to keep'}><textarea required={!existing?.storage} maxLength={500} rows={3} placeholder={existing?.storage ? guide.question : undefined} value={draft.question} onChange={event => setDraft({ ...draft, question: event.target.value })} /></Field>
  </RecordForm>{error && <p role="alert" className="hg-error">{error}</p>}</>;
}

function SavedFoodNote(props: WorkspaceProps) {
  const notes = useHomeCollection<PantryItem>('pantryItems', initialPantryItems);
  const { pending, scenario } = useHomeWorkspace();
  const note = notes.records.find(item => item.id === props.recordId);
  const guide = foodGuide(note?.guideId);
  const [deleting, setDeleting] = useState(false);
  if (!note || !guide) return <Empty title="This food note is unavailable" action={<button type="button" onClick={() => props.navigate('pantry-saved')}>Return to your notes</button>}><p>It may have been removed.</p></Empty>;
  if (props.view === 'pantry-edit') return <div className="hg-stack hg-pantry"><PageIntro eyebrow="YOUR KITCHEN" title={note.storage ? 'Edit your food' : 'Edit your note'} description="Keep the question useful and specific." icon={<NotebookPen />} /><section className="hg-card"><FoodNoteForm key={`${note.id}:${note.revision}`} guide={guide} origin={note.origin} suggestedQuestion={note.question} existing={note} onSaved={id => props.navigate('pantry-note', id)} onCancel={() => props.navigate('pantry-note', note.id)} /></section></div>;
  const context = foodOriginContext(guide, note.origin);
  return <div className="hg-stack hg-pantry"><PageIntro eyebrow={note.storage ? `YOUR ${foodStorageLabels[note.storage].toUpperCase()}` : 'YOUR FOOD NOTE'} title={note.title} description={`${foodOriginLabels[note.origin]} · ${guide.title}`} icon={<Bookmark />} />
    <div className="hg-food-item-tools" role="group" aria-label={note.storage ? 'Food record tools' : 'Food note tools'}><button type="button" className="hg-garden-tool" onClick={() => props.navigate('pantry-edit', note.id)}><Pencil size={17} aria-hidden="true" />{note.storage ? 'Edit food' : 'Edit note'}</button><DeleteButton label={note.storage ? 'Remove food' : 'Delete note'} disabled={pending || scenario === 'offline'} onClick={() => setDeleting(true)} /></div>
    {note.storage && <><section className="hg-card"><span className="hg-kicker">YOUR ITEM</span><h3>Not measured yet</h3><FoodResultBadges /><p className="hg-meta">No matching food-sample report. Unknown does not mean zero. Public study results below do not fill in these levels.</p>{note.foodId && <p className="hg-meta">Food type: {catalogueFood(note.foodId)?.name}. Your label does not change the evidence match.</p>}</section><PublishedFoodEvidence foodId={note.foodId} guideId={guide.id} /></>}
    <section className="hg-card"><span className="hg-kicker">{note.question ? 'YOUR QUESTION' : 'A POSSIBLE NEXT STEP'}</span><p className="hg-note-question">{note.question || 'Check a matching notice or add a question whenever you need to.'}</p><div className="hg-actions"><ActionButton title={`Check ${note.title}`} reason={note.question || `Check whether a current PFAS or lead notice applies to ${note.title}. Match the exact product and lot before drawing a conclusion.`} factor="water" originId={`pantry-${note.id}`} /></div><p className="hg-meta">Private note. No food result is implied.</p></section>
    <WorkspaceLink title={context.nextTitle} detail={context.nextDetail} onClick={() => props.navigate(context.nextView)} />
    <WorkspaceLink title={`Read the ${guide.title.toLowerCase()} guide`} detail="Return to the source and its limits." onClick={() => props.navigate('pantry-detail', guide.id)} />
    <button type="button" className="hg-button-secondary" onClick={() => props.navigate('pantry-saved')}>{note.storage ? 'Back to my kitchen' : 'All food notes'}</button>
    {deleting && <Confirm revisionKey={`${note.id}:${note.revision}`} title={note.storage ? 'Remove this food?' : 'Delete this food note?'} danger onCancel={() => setDeleting(false)} onConfirm={async () => { if (await notes.remove(note.id)) { setDeleting(false); props.navigate('pantry-saved'); } }}><p>This removes this food record. Source guides and My Week tasks are kept.</p></Confirm>}
  </div>;
}
