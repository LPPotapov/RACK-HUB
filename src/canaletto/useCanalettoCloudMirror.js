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
// gating the local UI.
//
// INBOUND: subscribes to `privateState` so a change committed from the
// OTHER director's machine appears here too, applied via the SAME
// restoreCanalettoEvent() (application/canalettoBackup.js) the file-backup
// "Restore Backup" flow uses — REPLACE, never merge. Both director UIDs
// are confirmed able to write concurrently with plain last-write-wins (no
// conflict resolution) — whichever machine's write reaches the database
// last is what every other subscriber converges to, including this one.
//
// ECHO GUARD: `lastRemoteJsonRef` records the JSON of the most recent
// value received FROM the listener; the outbound effect skips writing
// when local `event` already equals it, so applying a remote update does
// not immediately bounce right back out as a redundant write.

import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!auth.isDirector) return undefined;
    const json = JSON.stringify(event);
    if (json === lastRemoteJsonRef.current) return undefined;

    const timer = setTimeout(() => {
      writePrivateState(event);
      writePublicState(derivePublicState(event, null));
    }, MIRROR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [event, auth.isDirector]);

  useEffect(() => {
    if (!auth.isDirector) return undefined;
    return subscribePrivateState(
      (remoteEvent) => {
        if (!remoteEvent) return; // nothing published yet
        const remoteJson = JSON.stringify(remoteEvent);
        lastRemoteJsonRef.current = remoteJson;
        if (remoteJson === JSON.stringify(eventRef.current)) return;
        runRef.current(restoreCanalettoEvent, remoteEvent);
      },
      (error) => console.warn('Canaletto cloud sync: privateState listener error', error)
    );
  }, [auth.isDirector]);

  return auth;
};
