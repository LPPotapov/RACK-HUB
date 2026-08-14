// React state ownership for Canaletto LIVE/broadcast state — the TV-match
// pointer and its independent broadcast score (see
// src/application/canalettoLive.js). Persisted to ITS OWN localStorage key,
// deliberately separate from `canaletto-event-v1` (the authoritative
// tournament state) — this is what keeps the broadcast score structurally
// unable to affect official results, not just a "please don't touch this"
// convention.
//
// Used by BOTH the director app (LivePage.jsx, to select the TV match) and
// the standalone LIVE pages (TvOverlayPage/TvScoreControlPage, opened as
// separate browser tabs/OBS Browser Sources) — every consumer shares this
// one hook. Cross-tab updates rely on the browser's native `storage` event,
// which fires in every OTHER tab/window sharing the same browser profile
// and origin whenever one of them writes this key — no backend/polling
// needed for the current offline-first milestone. This does NOT reach an
// OBS Browser Source's separate embedded-browser process (a different
// storage partition) — see docs note in LivePage.jsx for the practical
// implication.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCanalettoLiveState, validateCanalettoLiveState } from '../application/canalettoLive.js';

export const CANALETTO_LIVE_STORAGE_KEY = 'canaletto-live-v1';
const STORAGE_KEY = CANALETTO_LIVE_STORAGE_KEY;

const loadInitialLiveState = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createCanalettoLiveState();
    const parsed = JSON.parse(raw);
    const result = validateCanalettoLiveState(parsed);
    if (!result.valid) {
      console.warn('Canaletto Live: stored state failed validation, starting fresh', result.errors);
      return createCanalettoLiveState();
    }
    return parsed;
  } catch (e) {
    console.warn('Canaletto Live: could not restore stored state, starting fresh', e);
    return createCanalettoLiveState();
  }
};

export const useCanalettoLiveState = () => {
  const [liveState, setLiveState] = useState(loadInitialLiveState);
  const liveStateRef = useRef(liveState);
  liveStateRef.current = liveState;

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(liveState));
  }, [liveState]);

  // Picks up a write made by ANOTHER tab (e.g. the director selecting a new
  // TV match while a score-control tab is already open) — never fires for
  // this same tab's own writes, so it can't fight with the `run()` below.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return;
      if (!e.newValue) {
        setLiveState(createCanalettoLiveState());
        return;
      }
      try {
        const parsed = JSON.parse(e.newValue);
        if (validateCanalettoLiveState(parsed).valid) setLiveState(parsed);
      } catch {
        // Malformed external write — ignore, keep current state.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Same synchronous-command pattern as useCanalettoEvent.js's run() — a
  // pure canalettoLive.js function applied directly, so a caller can branch
  // on success/failure in the same tick. Throws (e.g. setTvScore with no
  // match selected) are caught here and reported to the console rather than
  // crashing a broadcast-facing page.
  const run = useCallback((fn, ...args) => {
    try {
      const next = fn(liveStateRef.current, ...args);
      liveStateRef.current = next;
      setLiveState(next);
      return true;
    } catch (e) {
      console.warn('Canaletto Live: action failed:', e.message);
      return false;
    }
  }, []);

  return { liveState, run };
};
