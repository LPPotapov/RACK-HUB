// READ-ONLY access to the authoritative CanalettoEvent, for the public
// livescore page and the OBS overlay pages. Deliberately exposes no `run()`
// / mutation capability at all — unlike useCanalettoEvent.js (the director
// app's hook), there is structurally no way for anything built on this hook
// to write back to `canaletto-event-v1`. Reuses useCanalettoEvent.js's own
// loadInitialEvent() (including its migration shims) rather than
// duplicating that logic — one loader, two consumers.
//
// Cross-tab updates rely on the browser's native `storage` event (fires in
// every OTHER tab/window sharing the same browser profile+origin whenever
// the director's tab writes this key) — no backend/polling for this
// offline-first milestone. See LivePage.jsx for the OBS Browser Source
// caveat (a separate embedded-browser process does not share this
// storage).

import { useEffect, useState } from 'react';
import { CANALETTO_EVENT_STORAGE_KEY, loadInitialEvent } from '../useCanalettoEvent.js';

export const useCanalettoEventReadOnly = () => {
  const [event, setEvent] = useState(loadInitialEvent);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== CANALETTO_EVENT_STORAGE_KEY) return;
      setEvent(loadInitialEvent());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return event;
};
