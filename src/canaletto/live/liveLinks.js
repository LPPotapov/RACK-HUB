// Pure route/link definitions for the LIVE tab's link list (LivePage.jsx)
// AND for CanalettoLiveRouter.jsx's dispatch — ONE list, so a route added
// here is automatically both linkable from the director app and routable
// at the top level, never two lists that could drift apart. Stable,
// bookmarkable query-param routes (`?live=<key>[&block=A|B]`) on the SAME
// app URL — matches the existing `?legacy=1` pattern in App.jsx exactly,
// deliberately not a routing library (offline-first MVP; "no
// overengineering").

import { CURRENT_EVENT_SELECTOR } from '../../firebase/canalettoCloudPaths.js';

export const LIVE_LINKS = [
  { key: 'livescore', label: 'Public Livescore', query: 'live=livescore' },
  { key: 'tv-overlay', label: 'TV Match Overlay (OBS lower-third)', query: 'live=tv-overlay' },
  { key: 'tv-control', label: 'TV Overlay Score Control (streaming staff)', query: 'live=tv-control' },
  { key: 'top12-a', label: 'Top 12 — Block A (OBS)', query: 'live=top12&block=A' },
  { key: 'top12-b', label: 'Top 12 — Block B (OBS)', query: 'live=top12&block=B' },
  { key: 'block-results-a', label: 'Block A Results (full screen)', query: 'live=block-results&block=A' },
  { key: 'block-results-b', label: 'Block B Results (full screen)', query: 'live=block-results&block=B' },
  { key: 'bracket', label: 'Top16 Bracket (full screen, OBS)', query: 'live=bracket' }
];

// Absolute, shareable URL for a link's query string — same origin+path as
// the running app (this offline-first milestone has no separate public
// host yet; the route itself is what stays stable for when one exists).
export const buildLiveUrl = (origin, pathname, query) => `${origin}${pathname}?${query}`;

// URGENT ARCHITECTURE FIX ("bind OBS/live links to current director
// event"): every generated/copyable public/OBS/stream link must carry the
// director's OWN active event selector EXPLICITLY — workspace, test, or
// canaletto2026 (CURRENT_EVENT_SELECTOR, the ONE central selection, see
// canalettoCloudPaths.js) — and must NEVER omit it. Omitting it used to be
// safe when the implicit default was production; now that the implicit
// default is the (possibly-empty) workspace namespace, a link that forgot
// to carry the director's test/historical selector would silently open a
// DIFFERENT tournament than the one the director is actually running —
// exactly the bug this fix closes. Callers should build a link's full
// query via THIS helper rather than reading CURRENT_EVENT_SELECTOR/
// re-parsing the URL themselves.
export const withEventParam = (query) => `${query}&event=${CURRENT_EVENT_SELECTOR}`;
