/**
 * What production Luna can and cannot do, said the same way at every entry point
 * (the shared launcher, the My Week header, a note's "Prepare with Luna" and Settings).
 *
 * Luna answers and cites but does not act (B03, Vibhav's Option A), and notes are
 * household data that never go to the model service (B09 decision 2), so no screen
 * may invite a task, a reminder or a note selection that Luna would silently drop.
 * The server's own wording lives in lib/luna.js (LUNA_SELF_SERVE_ACTIONS); keep the two aligned.
 */
export const lunaCapabilityCopy = {
 answersOnly: 'Luna answers questions. It cannot add tasks, set reminders, save notes or change anything in HALO.',
 selfServe: 'To add a task or ask for a reminder, open My Week and choose Add task.',
 notesNotSent: 'Notes and Journal text are never sent to Luna.',
 noteUnavailable: 'Luna cannot read your notes, so nothing from this note is sent. You can still ask Luna a general question; avoid pasting private details into it.',
 noteAsk: 'Ask Luna a general question',
 unavailable: 'Luna is unavailable right now. You can still use HALO directly.',
 checking: 'Checking Luna...',
} as const;
