// Offline tournament backup/restore (LIVE/director safety-net pass) — an
// explicit, file-based safety mechanism INDEPENDENT of localStorage, so the
// event can be reconstructed if browser/localStorage state is ever lost.
// Deliberately does NOT invent a second tournament representation: a backup
// is just the SAME authoritative CanalettoEvent object useCanalettoEvent.js
// already persists to `canaletto-event-v1`, wrapped with a little metadata.
// Saving/validating/restoring here are pure, DOM-free functions — the
// browser-only bits (file download, file picker, confirmation UI) live in
// src/canaletto/BackupControls.jsx, which is the only caller of this module.
//
// Backup file shape:
//   {
//     backupType: 'rack-hub-canaletto-event',
//     backupVersion: 1,
//     exportedAt: ISO-8601 string,
//     source: 'event' | 'blockA' | 'blockB' | 'ko' | null,  // informational only — restore never depends on it
//     event: { ...the FULL CanalettoEvent, unmodified... },
//     liveState?: { ...canalettoLive.js CanalettoLiveState, if supplied... }
//   }
//
// `event` is saved AS-IS regardless of which page the save was triggered
// from — it is already the complete authoritative object (settings,
// schedule, tables, both blocks' rosters/rounds/results/locks, KO stages/
// results/GBR weight, table confirmations, etc.), so there is nothing
// page-specific to strip or add.

import { validateCanalettoEvent } from './canalettoEvent.js';
import { validateCanalettoLiveState } from './canalettoLive.js';

export const CANALETTO_BACKUP_TYPE = 'rack-hub-canaletto-event';
export const CANALETTO_BACKUP_VERSION = 1;

// Read-only: builds a new plain object referencing `event`/`liveState`
// as-is — never mutates either, never touches `event.settings`/schedule/
// tables/blocks/ko, and the only NEW value anywhere is the backup
// envelope's own `exportedAt` timestamp (director correction pass item 10 —
// "Only backup metadata exportedAt may be new").
export const createCanalettoBackup = (event, { source = null, liveState = null } = {}) => {
  const backup = {
    backupType: CANALETTO_BACKUP_TYPE,
    backupVersion: CANALETTO_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    source,
    event
  };
  if (liveState) backup.liveState = liveState;
  return backup;
};

// Validates a PARSED (already JSON.parse()'d) backup file before anything
// is allowed to touch live state (director correction pass item 7 — "never
// blindly replace state from arbitrary JSON"). Checks the envelope
// (type/version) AND delegates the nested event to the SAME
// validateCanalettoEvent() the app's own localStorage loader uses — one
// validator, not a second one that could drift. `liveState`, if present, is
// validated too, but its absence is never an error (it is an optional,
// non-authoritative extra).
export const validateCanalettoBackup = (parsed) => {
  const errors = [];
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, errors: ['Backup file must contain a single JSON object'] };
  }
  if (parsed.backupType !== CANALETTO_BACKUP_TYPE) {
    errors.push(`Unrecognized backupType "${parsed.backupType}" — expected "${CANALETTO_BACKUP_TYPE}"`);
  }
  if (parsed.backupVersion !== CANALETTO_BACKUP_VERSION) {
    errors.push(`Unsupported backupVersion "${parsed.backupVersion}" — expected ${CANALETTO_BACKUP_VERSION}`);
  }
  const eventResult = validateCanalettoEvent(parsed.event);
  if (!eventResult.valid) {
    eventResult.errors.forEach((e) => errors.push(`event: ${e}`));
  }
  if (parsed.liveState !== undefined && parsed.liveState !== null) {
    const liveResult = validateCanalettoLiveState(parsed.liveState);
    if (!liveResult.valid) liveResult.errors.forEach((e) => errors.push(`liveState: ${e}`));
  }
  return { valid: errors.length === 0, errors };
};

// The actual "commit" step — a pure function shaped exactly like every
// other canalettoEvent.js command (`(event, ...args) => nextEvent`), so the
// director app's existing `run(fn, ...args)` (see useCanalettoEvent.js) can
// apply it unchanged: same synchronous success/failure handling, same
// localStorage persistence path, no new plumbing.
//
// REPLACE, never merge (director correction pass item 9): `currentEvent` is
// deliberately never read — the backup's event becomes the entire next
// state, full stop. Re-validates `backupEvent` itself (defense in depth —
// this function does not assume its caller already ran
// validateCanalettoBackup(); UI code always should, so the confirmation
// summary has real data to show, but this guard is what makes the replace
// itself safe even if called directly).
export const restoreCanalettoEvent = (currentEvent, backupEvent) => {
  const result = validateCanalettoEvent(backupEvent);
  if (!result.valid) {
    throw new Error(`restoreCanalettoEvent: backup event failed validation: ${result.errors.join('; ')}`);
  }
  return backupEvent;
};

const pad2 = (n) => String(n).padStart(2, '0');

const slugify = (text) => {
  const slug = (text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'canaletto-event';
};

// Human-readable, sortable, colon-free filename — e.g.
// "canaletto-cup-2026-backup-2026-08-14-1845.json". Uses LOCAL date/time
// (not UTC) and a 24-hour clock (no AM/PM), matching the rest of the app's
// European-style time display (see schedule.js's formatScheduleRange).
export const buildBackupFilename = (eventTitle, date = new Date()) => {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return `${slugify(eventTitle)}-backup-${y}-${m}-${d}-${hh}${mm}.json`;
};
