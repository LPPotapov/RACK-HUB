// Single source of truth for detecting the public Canaletto Cup 2026
// custom domain (canaletto.bc-joes.de). Shared between App.jsx's routing
// default (root -> Livescore) and any public page needing hostname-gated
// presentation (e.g. LivescorePage's large event-identity heading) — the
// director app's own host (rack-hub-canaletto.web.app) must never match.
export const CANALETTO_PUBLIC_HOSTNAME = 'canaletto.bc-joes.de';

export const isCanalettoPublicDomain = () => window.location.hostname === CANALETTO_PUBLIC_HOSTNAME;

// Fixed public-archive label for this hostname — presentation-layer only.
// Production's event.settings.title is just "Canaletto Cup" (no year);
// rather than touch Firebase data, the public banner and tab title both
// read this constant instead, so they can't drift apart from each other.
export const CANALETTO_PUBLIC_EVENT_TITLE = 'Canaletto Cup 2026';

// Landing-page title (canaletto.bc-joes.de root) — deliberately year-less;
// the root is now an event-selector, not a single event's page.
export const CANALETTO_LANDING_TITLE = 'Canaletto Cup';

// Trailing slash(es) collapse to the same path ("/2026" and "/2026/" are
// the same route); the bare root normalizes to "/".
export const normalizeCanalettoPath = (pathname) => (pathname || '/').replace(/\/+$/, '') || '/';

export const isCanalettoArchive2026Path = (pathname) => normalizeCanalettoPath(pathname) === '/2026';

// Pure function of (hostname, pathname, search) — no `window`/`document`
// access of its own — so the routing precedence App.jsx renders from is
// directly unit-testable without mounting React or a browser DOM:
//   A. an explicit `?live=...` always wins, on ANY host (OBS/stream links,
//      and canaletto.bc-joes.de/?live=livescore as a Firebase-backed
//      backup/diagnostic view, must keep working unchanged);
//   B. canaletto.bc-joes.de/2026 (or /2026/) -> the static 2026 archive;
//   C. any other canaletto.bc-joes.de path (including bare "/") -> the
//      landing/event-selector page;
//   D. elsewhere, `?legacy=1` -> the legacy app, otherwise the director app
//      (rack-hub-canaletto.web.app's normal behavior, untouched).
export const resolveCanalettoRoute = ({ hostname, pathname, search }) => {
  const params = new URLSearchParams(search ?? '');
  const onPublicDomain = hostname === CANALETTO_PUBLIC_HOSTNAME;
  const explicitLiveView = params.get('live');
  if (explicitLiveView) return { kind: 'live', view: explicitLiveView, onPublicDomain };
  if (onPublicDomain) return { kind: isCanalettoArchive2026Path(pathname) ? 'archive2026' : 'landing' };
  if (params.get('legacy') === '1') return { kind: 'legacy' };
  return { kind: 'director' };
};
