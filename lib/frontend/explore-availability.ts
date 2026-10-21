/**
 * What Explore says when a capability is switched off on the server (a read answered 503
 * feature_unavailable). That is a settled answer, not an outage: say it is not available yet,
 * point to what still works and offer no retry. Wording follows lib/features.js DISABLED_REASON.
 */
export const listingsOff = 'Local listings are not available yet. Use the organizers’ official sites below.';
export const organizationsOff = 'Organization profiles are not available yet. Use the official resources below.';
export const projectsOff = 'Project ideas are not available yet. The rest of Explore still works.';
export const notesOff = 'Saving private notes is not available yet. Nothing in your notebook was changed.';
export const outreachOff = 'Sending from HALO is not available yet. Nothing was sent. Copy the message and send it from your own email.';
