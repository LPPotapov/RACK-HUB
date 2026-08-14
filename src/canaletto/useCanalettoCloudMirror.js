// Director-side cloud mirror (Canaletto Cup 2026 cloud sync pass — see
// docs/decisions/0005-firebase-realtime-backend.md). Composed into
// CanalettoApp.jsx alongside the existing, UNCHANGED useCanalettoEvent()
// hook. Purely additive: while signed OUT (or Firebase isn't configured —
// see firebaseApp.js), this hook does nothing at all and the app behaves
// exactly as it did before this pass — localStorage remains the
// synchronous, always-available local source of truth.
//
// STATE MODEL (fresh-empty-tournament hotfix):
//   remoteStatus: 'loading' | 'empty' | 'valid' | 'invalid'
//     What the privateState listener has most recently observed —
//     'loading' before the first callback ever fires, 'empty' when the
//     path has genuinely never been published to (or was intentionally
//     deleted — "we DO NOT want to restore/migrate any previous
//     tournament"), 'valid'/'invalid' once a real payload has been
//     decoded and validated.
//   syncMode: 'notPublished' | 'active'
//     Whether this director's LOCAL changes are allowed to auto-mirror
//     out. Starts 'notPublished' and stays there for as long as the cloud
//     is empty — a brand-new local tournament is NEVER auto-published
//     just because a director happens to be signed in; it only becomes
//     'active' after an EXPLICIT publishToCloud() call succeeds (either
//     the director's own "Publish Current to Cloud" click, or — for a
//     RETURNING session where the cloud already holds a valid tournament —
//     immediately, since a director signing into an already-live event
//     should sync with it normally, not be asked to "publish" over it).
//
// OUTBOUND: once `syncMode === 'active'`, every local `event` change is
// mirrored to `/events/canaletto2026/privateState` (full authoritative
// event) and `/events/canaletto2026/publicState` (derivePublicState()
// projection) — debounced, best-effort, never blocking the local UI.
// VALIDATED FIRST: if validateCanalettoEvent(event) fails, the write is
// skipped and remoteStatus-adjacent `cloudErrors` explains why ("CLOUD
// PUBLISH BLOCKED"). While `syncMode === 'notPublished'`, this effect does
// NOT run at all — no local state, however fresh/bootstrap, is ever
// written automatically.
//
// INBOUND: subscribes to `privateState`. `remoteEvent === null` (genuinely
// nothing published, or deleted) is CLOUD EMPTY — a normal, fully
// supported state, never treated as an error, never decoded as if it were
// an event, never fed to restoreCanalettoEvent(), never replaces local
// state, and never triggers an automatic publish. Only a REAL, VALID
// remoteEvent is ever applied locally, via the SAME restoreCanalettoEvent()
// (application/canalettoBackup.js) the file-backup "Restore Backup" flow
// uses — REPLACE, never merge. A REAL but INVALID remoteEvent is never
// passed to restoreCanalettoEvent() either — local state stays completely
// untouched, and the director can explicitly `publishToCloud()` (typed-
// confirmation gated in CloudSyncPanel.jsx) to overwrite it.
//
// FAIL-SAFE: every Firebase-touching callback body runs inside try/catch.
// A decode/validation/listener exception becomes a `cloudStatus: 'error'`
// warning, NEVER an uncaught throw that could reach a React render — see
// CloudErrorBoundary.jsx for the narrow defense-in-depth backstop around
// CloudSyncPanel's own UI on top of this.
//
// Both director UIDs are confirmed able to write concurrently, once
// syncMode is 'active', with plain last-write-wins (no conflict
// resolution) — whichever machine's write reaches the database last is
// what every other subscriber converges to.

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

  const [remoteStatus, setRemoteStatus] = useState('loading');
  const [syncMode, setSyncMode] = useState('notPublished');
  const [cloudErrors, setCloudErrors] = useState([]);
  // Kept for CloudSyncPanel.jsx's existing 'publishBlocked'/'invalid'
  // messaging — derived from remoteStatus/syncMode rather than a third
  // independent flag.
  const cloudStatus = remoteStatus === 'invalid' ? 'invalid' : syncMode === 'notPublished' ? 'notPublished' : 'ok';

  // Reset per sign-in/out — a fresh auth session should re-observe the
  // cloud's actual current state rather than carry over a stale flag from
  // a previous session (e.g. a prior sign-out while syncMode was 'active').
  useEffect(() => {
    if (!auth.isDirector) return;
    setRemoteStatus('loading');
    setSyncMode('notPublished');
    setCloudErrors([]);
    lastRemoteJsonRef.current = null;
  }, [auth.isDirector]);

  useEffect(() => {
    if (!auth.isDirector) return undefined;
    return subscribePrivateState(
      (remoteEvent) => {
        try {
          if (!remoteEvent) {
            // CLOUD EMPTY — a normal, fully supported state. Never decode
            // as an event, never validate, never restore, never mark
            // local invalid, never auto-publish.
            setRemoteStatus('empty');
            return;
          }
          const result = validateCanalettoEvent(remoteEvent);
          if (!result.valid) {
            // NEVER call restoreCanalettoEvent() on invalid data — local
            // tournament state is left completely untouched.
            setRemoteStatus('invalid');
            setCloudErrors(result.errors);
            return;
          }
          setRemoteStatus('valid');
          setCloudErrors([]);
          setSyncMode('active'); // cloud already holds a real tournament — sync normally, no "publish" prompt needed
          const remoteJson = JSON.stringify(remoteEvent);
          lastRemoteJsonRef.current = remoteJson;
          if (remoteJson === JSON.stringify(eventRef.current)) return;
          runRef.current(restoreCanalettoEvent, remoteEvent);
        } catch (e) {
          console.warn('Canaletto cloud sync: error handling privateState update', e);
          setRemoteStatus('invalid');
          setCloudErrors([e.message || 'Unknown cloud sync error']);
        }
      },
      (error) => {
        console.warn('Canaletto cloud sync: privateState listener error', error);
        setCloudErrors([error.message || 'Cloud connection error']);
      }
    );
  }, [auth.isDirector]);

  // Outbound mirror — ONLY once syncMode is 'active'. A brand-new local
  // tournament, however complete, is never written just because a
  // director happens to be signed in while the cloud is still empty.
  useEffect(() => {
    if (!auth.isDirector || syncMode !== 'active') return undefined;
    const json = JSON.stringify(event);
    if (json === lastRemoteJsonRef.current) return undefined;

    const timer = setTimeout(() => {
      try {
        const result = validateCanalettoEvent(event);
        if (!result.valid) {
          setCloudErrors(result.errors);
          return;
        }
        writePrivateState(event);
        writePublicState(derivePublicState(event, null));
        setCloudErrors([]);
      } catch (e) {
        console.warn('Canaletto cloud sync: outbound publish failed', e);
        setCloudErrors([e.message || 'Unknown cloud sync error']);
      }
    }, MIRROR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [event, auth.isDirector, syncMode]);

  // The ONE explicit, director-initiated write path (event-blocking cloud
  // sync fix item 5/7 — "publishFullLocalEventToCloud" / "PUBLISH CURRENT
  // TO CLOUD"): used both for the very first publish (cloud was empty/
  // notPublished) and for the "replace invalid cloud with this local
  // tournament" repair action — both are the exact same operation.
  // Force-writes the CURRENT local event as-is, after re-validating it.
  // Never derives/sanitizes privateState — the full local event goes to
  // privateState unmodified; only publicState goes through
  // derivePublicState(), exactly like the ordinary outbound mirror above.
  // `/live` is intentionally left untouched. Gated behind a typed
  // confirmation in CloudSyncPanel.jsx — never called automatically.
  const publishToCloud = useCallback(() => {
    const currentEvent = eventRef.current;
    try {
      const result = validateCanalettoEvent(currentEvent);
      if (!result.valid) {
        setCloudErrors(result.errors);
        return { ok: false, errors: result.errors };
      }
      writePrivateState(currentEvent);
      writePublicState(derivePublicState(currentEvent, null));
      lastRemoteJsonRef.current = JSON.stringify(currentEvent);
      setRemoteStatus('valid');
      setSyncMode('active');
      setCloudErrors([]);
      return { ok: true };
    } catch (e) {
      console.warn('Canaletto cloud sync: publishToCloud failed', e);
      setCloudErrors([e.message || 'Unknown cloud sync error']);
      return { ok: false, errors: [e.message || 'Unknown cloud sync error'] };
    }
  }, []);

  return {
    ...auth,
    remoteStatus,
    syncMode,
    cloudStatus,
    cloudErrors,
    publishToCloud,
    // Back-compat alias — CloudSyncPanel.jsx's existing "repair invalid
    // cloud" action is literally the same operation as first-publish.
    repairCloudWithLocal: publishToCloud
  };
};
