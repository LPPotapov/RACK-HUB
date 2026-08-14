// Pure route/link definitions for the LIVE tab's link list (LivePage.jsx)
// AND for CanalettoLiveRouter.jsx's dispatch — ONE list, so a route added
// here is automatically both linkable from the director app and routable
// at the top level, never two lists that could drift apart. Stable,
// bookmarkable query-param routes (`?live=<key>[&block=A|B]`) on the SAME
// app URL — matches the existing `?legacy=1` pattern in App.jsx exactly,
// deliberately not a routing library (offline-first MVP; "no
// overengineering").

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
