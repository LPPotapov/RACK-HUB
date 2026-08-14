// Cross-machine TV/broadcast state (Canaletto Cup 2026 cloud sync pass) —
// subscribes to (and, for an authorized signed-in user, writes)
// `/events/canaletto2026/live`. Same `{ liveState, run }` shape as the
// existing local useCanalettoLiveState.js so callers use it identically.
//
// Read-only use: TvOverlayPage.jsx (public OBS ticker — no auth, just
// ignores `run`/`canWrite`).
// Read+write use: TvScoreControlPage.jsx (streaming staff), gated on
// `canWrite` — true only when signed in as an authorized director OR the
// stream/Qniverse UID, the only two roles the security rules permit to
// write this node.
//
// `run(fn, ...args)` applies the pure canalettoLive.js command (
// selectTvMatch/clearTvMatch/setTvScore) locally FIRST for instant UI
// feedback, then mirrors the result out — same synchronous-command pattern
// useCanalettoLiveState.js's own `run()` already establishes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCanalettoLiveState } from '../../application/canalettoLive.js';
import { subscribeLiveState, writeLiveState } from '../../firebase/canalettoCloudSync.js';
import { useFirebaseAuth } from '../../firebase/useFirebaseAuth.js';

export const useCloudLiveState = () => {
  const auth = useFirebaseAuth();
  const [liveState, setLiveState] = useState(createCanalettoLiveState);
  const liveStateRef = useRef(liveState);
  liveStateRef.current = liveState;

  useEffect(
    () =>
      subscribeLiveState(
        (value) => {
          if (!value) return;
          liveStateRef.current = value;
          setLiveState(value);
        },
        (error) => console.warn('Canaletto cloud sync: live listener error', error)
      ),
    []
  );

  const canWrite = auth.isDirector || auth.isStream;

  const run = useCallback(
    (fn, ...args) => {
      if (!canWrite) return false;
      try {
        const next = fn(liveStateRef.current, ...args);
        liveStateRef.current = next;
        setLiveState(next);
        writeLiveState(next);
        return true;
      } catch (e) {
        console.warn('Canaletto cloud sync: live action failed:', e.message);
        return false;
      }
    },
    [canWrite]
  );

  return { liveState, run, canWrite, auth };
};
