// Pure, deterministic formatting for optional estimated schedule entries
// (director correction pass, item 6) — `{ start, end }` where each is either
// '' (unset) or the exact string an `<input type="datetime-local">` produces
// ("YYYY-MM-DDTHH:MM"). Deliberately does NOT use `Date`/`toLocaleString()`:
// those depend on the host's ICU/timezone data, which would make the same
// stored value render differently (or non-deterministically in tests)
// across environments — a datetime-local value has no timezone at all, so
// parsing it as a plain string is the only meaning-preserving option.
//
// EUROPEAN FORMAT ONLY (director correction pass, item 1): 24-hour HH:MM
// (never AM/PM — a datetime-local input's own hour segment is already
// 24-hour, so this is a straight passthrough, not a conversion) and
// DD.MM.YYYY date order.

const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

const parseLocalDateTime = (value) => {
  const match = DATETIME_LOCAL_PATTERN.exec(String(value || ''));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const monthNum = Number(month);
  if (monthNum < 1 || monthNum > 12) return null;
  return { year, month, day, hour, minute };
};

// Returns null when unset/unparseable — never a fake/default time (docs
// task item 6). Examples: "14.08.2026 · 18:00–19:00" (both set),
// "14.08.2026 · 18:00" (end unset/unparseable).
export const formatScheduleRange = ({ start, end } = {}) => {
  const s = parseLocalDateTime(start);
  if (!s) return null;
  const datePart = `${s.day}.${s.month}.${s.year}`;
  const startTime = `${s.hour}:${s.minute}`;
  const e = parseLocalDateTime(end);
  if (!e) return `${datePart} · ${startTime}`;
  return `${datePart} · ${startTime}–${e.hour}:${e.minute}`;
};

// Default-minutes-to-:00 safeguard (director correction pass, item 2). A
// spec-compliant `<input type="datetime-local">` only ever emits a complete
// "YYYY-MM-DDTHH:MM" value via onChange (there is no way to observe an
// "hour typed, minute not yet touched" intermediate state through the DOM
// value/onChange contract) — so in practice the browser itself already
// supplies the minute segment. This helper is the "smallest safe helper"
// defensive normalizer the task calls for: if a value is ever missing its
// minute component entirely (e.g. "YYYY-MM-DDTHH", which a spec-compliant
// browser will not produce, but a future caller constructing a value
// programmatically might), it defaults the minutes to "00" rather than
// leaving an ambiguous/invalid value. A value that already has an explicit
// minute — including a non-zero one the director deliberately typed, like
// "18:15" — is returned completely unchanged; this never overwrites an
// intentional choice.
export const normalizeDateTimeLocalValue = (value) => {
  const raw = String(value ?? '');
  if (raw === '') return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(raw)) return `${raw}:00`;
  return raw;
};

// ---------------------------------------------------------------------------
// EU-FORMATTED TEXT INPUT (correction — item 1 applies to the schedule
// INPUT fields too, not just the display). A native `<input
// type="datetime-local">`'s stored value/onChange contract is always
// "YYYY-MM-DDTHH:MM" regardless of locale, but the WIDGET ITSELF renders
// using the browser/OS locale — on a US-locale machine that's MM/DD/YYYY
// with an AM/PM picker, which is exactly the "American format" this
// correction rules out. There is no way to force a native date/time input's
// displayed format via HTML/CSS. The only reliable fix is to stop using
// that native widget for schedule entry and use plain text fields the
// director types DD.MM.YYYY / HH:MM into directly (EventPage.jsx's
// EuDateTimeField) — these helpers convert between that EU text
// representation and the internal "YYYY-MM-DDTHH:MM" storage format.
// ---------------------------------------------------------------------------

// Internal ISO value -> EU text, for populating the two input fields.
export const toEuDateInputValue = (value) => {
  const p = parseLocalDateTime(value);
  return p ? `${p.day}.${p.month}.${p.year}` : '';
};

export const toEuTimeInputValue = (value) => {
  const p = parseLocalDateTime(value);
  return p ? `${p.hour}:${p.minute}` : '';
};

const EU_DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const EU_TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

// EU text (DD.MM.YYYY, HH:MM) -> internal ISO value, or null if not yet a
// complete/valid date. A blank/omitted time defaults to :00 (docs task item
// 2 — "default minutes to :00"), matching the datetime-local behavior this
// replaces; a malformed (but non-blank) time is rejected rather than
// silently guessed. Returns '' only when BOTH fields are blank (matches
// updateCanalettoSchedule()'s own '' = unset convention) — never returns ''
// for a partially-typed, still-invalid value (caller must not commit that).
export const parseEuDateTimeInputs = (dateText, timeText) => {
  const d = String(dateText ?? '').trim();
  const t = String(timeText ?? '').trim();
  if (d === '' && t === '') return '';
  const dateMatch = EU_DATE_PATTERN.exec(d);
  if (!dateMatch) return null;
  const [, day, month, year] = dateMatch;
  const dayNum = Number(day);
  const monthNum = Number(month);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return null;

  let hour = '00';
  let minute = '00';
  if (t !== '') {
    const timeMatch = EU_TIME_PATTERN.exec(t);
    if (!timeMatch) return null;
    hour = timeMatch[1].padStart(2, '0');
    minute = timeMatch[2];
    if (Number(hour) > 23 || Number(minute) > 59) return null;
  }
  return `${year}-${month}-${day}T${hour}:${minute}`;
};
