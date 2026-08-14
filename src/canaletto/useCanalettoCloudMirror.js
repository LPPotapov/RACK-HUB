// Director-side cloud mirror (Canaletto Cup 2026 cloud sync pass — see
// docs/decisions/0005-firebase-realtime-backend.md). Composed into
// CanalettoApp.jsx alongside the existing, UNCHANGED useCanalettoEvent()
// hook. Purely additive: while signed OUT (or Firebase isn't configured —
// see firebaseApp.js), this hook does nothing at all and the app behaves
// exactly as it did before this pass — localStorage remains the
// synchronous, always-available local source of truth.
//
// OUTBOUND: every local `event` change is mirrored to
// `/events/canaletto2026/privateState` (full authoritative event, director
// read/write) and `/events/canaletto2026/publicState` (derivePublicState()
// projection, public read) — debounced, best-effort, never blocking or
// gating the local UI. VALIDATED FIRST (event-blocking cloud sync fix,
// item 3): if `validateCanalettoEvent(event)` fails, the write is skipped
// entirely and `cloudStatus` becomes `'publishBlocked'` — this should
// never actually trigger in practice (local `event` is always produced by
// already-tested pure commands), but it is the explicit safety net the
// director correction pass asked for rather than trusting that silently.
//
// INBOUND: subscribes to `privateState` so a change committed from the
// OTHER director's machine appears here too, applied via the SAME
// restoreCanalettoEvent() (application/canalettoBackup.js) the file-backup
// "Restore Backup" flow uses — REPLACE, never merge. VALIDATED FIRST
// (item 4): restoreCanalettoEvent() is only ever CALLED when
// `validateCanalettoEvent(remoteEvent)` already passed — an invalid/
// malformed remote value never reaches it, never touches local state, and
// never shows a destructive-looking restore dialog. Instead `cloudStatus`
// becomes `'invalid'` with the validation errors, and the director can
// explicitly `repairCloudWithLocal()` (typed-confirmation gated in
// CloudSyncPanel.jsx) to overwrite the cloud with the current, definitely-
// valid local tournament.
//
// Both director UIDs are confirmed able to write concurrently with plain
// last-write-wins (no conflict resolution) — whichever machine's write
// reaches the database last is what every other subscriber converges to.
//
// ECHO GUARD: `lastRemoteJsonRef` records the JSON of the most recent
// value received FROM the listener; the outbound effect skips writing
// when local `event` already equals it, so applying a remote update does
// not immediately bounce right back out as a redundant write.

import { useCallback, useEffect, useRef, useState } from 'react';
import { validateCanalettoEvent } from '../application/canalettoEvent.js';
import { restoreCanalettoEvent } from '../application/canalettoBackup.js';
import { derivePublicState } from '../application/canalettoPublicState.js';
import { subscribePrivateState, writePrivateState, writePublicState } from '../firebase/canalettoCloudSync.js';
import { useFirebaseAuth } from '../firebase/useFirebaseAuth.js';

const MIRROR_DEBOUNCE_MS = 800;

export const useCanalettoCloudMirror = (event, run) => {
  const auth = useFirebaseAuth();
  const eventRef = useRef(event);
  eventRef.current = event;
  const runRef = useRef(run);
  runRef.current = run;
  const lastRemoteJsonRef = useRef(null);

  // 'ok' | 'publishBlocked' | 'invalid' — see file header. `cloudErrors` is
  // the matching validateCanalettoEvent() error list for the last blocked
  // publish or rejected remote update.
  const [cloudStatus, setCloudStatus] = useState('ok');
  const [cloudErrors, setCloudErrors] = useState([]);

  useEffect(() => {
    if (!auth.isDirector) return undefined;
    const json = JSON.stringify(event);
    if (json === lastRemoteJsonRef.current) return undefined;

    const timer = setTimeout(() => {
      const result = validateCanalettoEvent(event);
      if (!result.valid) {
        setCloudStatus('publishBlocked');
        setCloudErrors(result.errors);
        return;
      }
      writePrivateState(event);
      writePublicState(derivePublicState(event, null));
      setCloudStatus('ok');
      setCloudErrors([]);
    }, MIRROR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [event, auth.isDirector]);

  useEffect(() => {
    if (!auth.isDirector) return undefined;
    return subscribePrivateState(
      (remoteEvent) => {
        if (!remoteEvent) return; // nothing published yet
        const result = validateCanalettoEvent(remoteEvent);
        if (!result.valid) {
          // NEVER call restoreCanalettoEvent() on invalid data — local
          // tournament state is left completely untouched. This is a
          // cloud-side data problem, not a local one.
          setCloudStatus('invalid');
          setCloudErrors(result.errors);
          return;
        }
        const remoteJson = JSON.stringify(remoteEvent);
        lastRemoteJsonRef.current = remoteJson;
        setCloudStatus('ok');
        setCloudErrors([]);
        if (remoteJson === JSON.stringify(eventRef.current)) return;
        runRef.current(restoreCanalettoEvent, remoteEvent);
      },
      (error) => console.warn('Canaletto cloud sync: privateState listener error', error)
    );
  }, [auth.isDirector]);

  // Explicit, director-initiated repair (event-blocking cloud sync fix,
  // item 5 — "publishFullLocalEventToCloud"): force-writes the CURRENT
  // local event as-is to both privateState and publicState, after
  // re-validating it. Never derives/sanitizes privateState — the full
  // local event goes to privateState unmodified; only publicState goes
  // through derivePublicState(), exactly like the ordinary outbound
  // mirror above. `/live` is intentionally left untouched. Gated behind a
  // typed confirmation in CloudSyncPanel.jsx — never called automatically.
  const repairCloudWithLocal = useCallback(() => {
    const currentEvent = eventRef.current;
    const result = validateCanalettoEvent(currentEvent);
    if (!result.valid) return { ok: false, errors: result.errors };
    writePrivateState(currentEvent);
    writePublicState(derivePublicState(currentEvent, null));
    lastRemoteJsonRef.current = JSON.stringify(currentEvent);
    setCloudStatus('ok');
    setCloudErrors([]);
    return { ok: true };
  }, []);

  return { ...auth, cloudStatus, cloudErrors, repairCloudWithLocal };
};
