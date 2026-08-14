// Public/OBS pages' cross-machine event source (Canaletto Cup 2026 cloud
// sync pass) — subscribes to `/events/canaletto2026/publicState` (no auth
// required; the security rules make this node publicly readable). Used in
// place of useCanalettoEventReadOnly.js (same-browser localStorage) by
// every actual public-facing route: LivescorePage.jsx, Top12OverlayPage.jsx,
// BlockResultsOverlayPage.jsx, BracketOverlayPage.jsx, TvOverlayPage.jsx.
// useCanalettoEventReadOnly.js itself is untouched.
//
// The returned value is shaped exactly like derivePublicState()'s output —
// the SAME field names/nesting as a CanalettoEvent minus the
// director-only fields it redacts — so every existing public component
// keeps calling the exact same canalettoEvent.js query functions
// (getBlockStandings, getBracketProjection, resolveTvMatch, etc.)
// unchanged, whether the object came from localStorage or from here.
//
// Before the first snapshot ever arrives (e.g. `publicState` has never
// been published yet, or the network hasn't responded), returns
// derivePublicState() of a fresh createCanalettoEvent() — the same "empty
// event" shape the app already shows for a brand new local tournament,
// never `null`/undefined that every consumer would need its own guard for.

import { useEffect, useState } from 'react';
import { createCanalettoEvent } from '../../application/canalettoEvent.js';
import { derivePublicState } from '../../application/canalettoPublicState.js';
import { subscribePublicState } from '../../firebase/canalettoCloudSync.js';

const EMPTY_PUBLIC_STATE = derivePublicState(createCanalettoEvent(), null);

export const useCloudPublicEvent = () => {
  const [publicState, setPublicState] = useState(EMPTY_PUBLIC_STATE);

  useEffect(
    () =>
      subscribePublicState(
        (value) => {
          if (value) setPublicState(value);
        },
        (error) => console.warn('Canaletto cloud sync: publicState listener error', error)
      ),
    []
  );

  return publicState;
};
