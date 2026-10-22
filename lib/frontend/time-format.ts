/**
 * HALO's one clock style for people: 12-hour US time with a plain space, "7:00 AM", and a dated range
 * "Sat, Nov 7, 2026 · 9:00 AM to 11:00 AM". Stored and compared values stay 24-hour "HH:MM" or ISO
 * instants; only what is shown goes through here. Intl's narrow and no-break spaces become plain spaces
 * so the server and the browser render the same text whatever ICU each carries.
 */
const plain = (text: string) => text.replace(/[\u202f\u00a0]/g, ' ');

/** A wall-clock "HH:MM" (an `<input type="time">` value, or "6:0" as a chart builds it) as "7:00 AM"; anything else is returned as it is. */
export function clockText(clock: string) {
  const match = /^(\d{1,2}):(\d{1,2})(?::\d{2})?$/.exec(clock);
  if (!match) return clock;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return clock;
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** An instant's clock time in `zone`, as "7:00 AM". */
export function instantClock(instant: string, zone: string) {
  return plain(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant)));
}

/** An instant's date in `zone`, as "Sat, Nov 7, 2026". */
export function instantDate(instant: string, zone: string) {
  return plain(new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(instant)));
}

/**
 * A dated event in its venue's zone: "Sat, Nov 7, 2026 · 9:00 AM to 11:00 AM", with the end's date too
 * when it ends on another day. Null when an instant or the zone is unusable, so the caller keeps its label.
 */
export function scheduleLabel(startsAt: string, endsAt: string, zone: string) {
  try {
    if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt))) return null;
    const startDay = instantDate(startsAt, zone), endDay = instantDate(endsAt, zone);
    const end = endDay === startDay ? instantClock(endsAt, zone) : `${endDay} · ${instantClock(endsAt, zone)}`;
    return `${startDay} · ${instantClock(startsAt, zone)} to ${end}`;
  } catch {
    return null;
  }
}
