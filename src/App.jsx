import { lazy, Suspense } from 'react';
import PoolTournamentApp from './PoolTournamentApp.jsx';
import { CanalettoArchive2026Page } from './canaletto/live/CanalettoArchive2026Page.jsx';
import { CanalettoLandingPage } from './canaletto/live/CanalettoLandingPage.jsx';
import { CANALETTO_LANDING_TITLE, CANALETTO_PUBLIC_EVENT_TITLE, resolveCanalettoRoute } from './canaletto/publicDomain.js';

// Director app and the Firebase-backed live/public router are the ONLY two
// branches that reach Firebase (firebaseApp.js/useFirebaseAuth.js/
// useCloudPublicEvent.js/canalettoCloudSync.js). React.lazy()'ing them
// through their own small entry-wrapper modules (CanalettoDirectorEntry.jsx/
// CanalettoLiveEntry.jsx) is what keeps Firebase's module graph — and its
// top-level initializeApp()/getAuth()/getDatabase() side effects — out of
// the eagerly executed main.jsx/App.jsx bundle entirely for every other
// route (canaletto.bc-joes.de's landing page and /2026 archive). Static
// source-level purity (see LivescorePresentation.jsx and its dependency-
// scan test) only proves a component never CALLS Firebase; a statically
// imported module is still fetched/evaluated regardless of which branch
// of App() actually renders — only a real import() boundary stops that.
// PoolTournamentApp.jsx (the `?legacy=1` branch) stays a static import:
// its own transitive import graph was checked and reaches no Firebase
// module, so there is nothing to isolate there.
const CanalettoDirectorEntry = lazy(() => import('./canaletto/CanalettoDirectorEntry.jsx'));
const CanalettoLiveEntry = lazy(() => import('./canaletto/live/CanalettoLiveEntry.jsx'));

// Suspense fallbacks, chosen by route TYPE before the lazy chunk has even
// loaded — resolveCanalettoRoute() already tells us `route.view`, so this
// never has to guess from inside the not-yet-loaded chunk:
//   - director: a minimal full-page dark shell, never the director login/
//     dashboard itself (that only exists inside the lazy chunk).
//   - public Livescore, and the streaming-staff TV score control page
//     (TvScoreControlPage.jsx — a real control panel a human reads in its
//     own browser tab, not a video-composited overlay): the SAME
//     restrained dark shell.
//   - true OBS Browser Source overlays (tv-overlay/top12/block-results/
//     bracket — each page's own header comment documents it as an OBS
//     overlay; tv-control/livescore are not) render NOTHING. These pages
//     already explicitly paint `bg-transparent` (OVERLAY_SHELL_OUTER_CLASS
//     in overlayShell.js) and index.html's <body> has no background of
//     its own, so an empty fallback is genuinely transparent — matching
//     the loaded overlay's own already-established contract, never an
//     opaque dark screen flashing over live stream footage.
const DarkLoadingShell = () => (
  <div className="flex min-h-screen items-center justify-center bg-canaletto-bg text-canaletto-lavender">
    <div className="font-condensed text-xs font-bold uppercase tracking-widest">Loading…</div>
  </div>
);

const OBS_TRANSPARENT_OVERLAY_VIEWS = new Set(['tv-overlay', 'top12', 'block-results', 'bracket']);

function App() {
  const params = new URLSearchParams(window.location.search);
  // All routing precedence lives in resolveCanalettoRoute() (publicDomain.js)
  // as a pure function — this component only acts on its result, so the
  // precedence itself stays unit-testable without mounting React. Resolved
  // BEFORE anything director-side is reachable, which is what guarantees
  // canaletto.bc-joes.de's root and /2026 never flash director login/dashboard.
  const route = resolveCanalettoRoute({
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    search: window.location.search
  });

  // A. Explicit `?live=...` always wins — OBS/stream links, and
  // canaletto.bc-joes.de/?live=livescore as a Firebase-backed backup/
  // diagnostic view, keep working exactly as before. No director auth gate
  // is ever mounted for these routes, not merely bypassed (urgent security
  // fix item 3).
  if (route.kind === 'live') {
    if (route.onPublicDomain) document.title = CANALETTO_PUBLIC_EVENT_TITLE.toUpperCase();
    const fallback = OBS_TRANSPARENT_OVERLAY_VIEWS.has(route.view) ? null : <DarkLoadingShell />;
    return (
      <Suspense fallback={fallback}>
        <CanalettoLiveEntry view={route.view} params={params} />
      </Suspense>
    );
  }
  // B. canaletto.bc-joes.de/2026 (or /2026/) -> the static, Firebase-free
  // 2026 archive. Stays a plain synchronous render — never behind
  // Suspense, so no Firebase-loading fallback can ever appear here, and no
  // Firebase code ever ships to this route's eager execution path.
  if (route.kind === 'archive2026') {
    document.title = CANALETTO_PUBLIC_EVENT_TITLE.toUpperCase();
    return <CanalettoArchive2026Page />;
  }
  // C. Any other canaletto.bc-joes.de path (including bare "/") -> the
  // landing/event-selector page. Same guarantee as B — plain synchronous
  // render, no Suspense, no Firebase.
  if (route.kind === 'landing') {
    document.title = CANALETTO_LANDING_TITLE.toUpperCase();
    return <CanalettoLandingPage />;
  }
  if (route.kind === 'legacy') return <PoolTournamentApp />;
  // D. Root/normal Canaletto director app (rack-hub-canaletto.web.app) —
  // the ONLY route this pass gates.
  return (
    <Suspense fallback={<DarkLoadingShell />}>
      <CanalettoDirectorEntry />
    </Suspense>
  );
}

export default App;
