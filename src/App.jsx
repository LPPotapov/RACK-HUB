import CanalettoApp from './canaletto/CanalettoApp.jsx';
import PoolTournamentApp from './PoolTournamentApp.jsx';
import { CanalettoLiveRouter } from './canaletto/live/CanalettoLiveRouter.jsx';
import { DirectorAuthGate } from './canaletto/DirectorAuthGate.jsx';

// The public custom domain for Canaletto Cup 2026 — opening its root with no
// explicit `?live=...` param should land on the public Livescore page, not
// the director app. The director app keeps living at its own Firebase
// web.app host; this hostname never mounts it.
const CANALETTO_PUBLIC_HOSTNAME = 'canaletto.bc-joes.de';

function App() {
  const params = new URLSearchParams(window.location.search);
  const isCanalettoPublicDomain = window.location.hostname === CANALETTO_PUBLIC_HOSTNAME;
  // Explicit `?live=...` always wins (OBS/stream links must keep working
  // unchanged); only fall back to `livescore` when none was given and we're
  // on the public domain. The URL itself is never rewritten.
  const liveView = params.get('live') || (isCanalettoPublicDomain ? 'livescore' : null);
  // LIVE/public/OBS routes (see liveLinks.js) are dispatched BEFORE the
  // legacy/CanalettoApp choice below — they render with no director chrome
  // (and, critically, no director auth gate) at all, since they're meant to
  // be opened as their own browser tabs/OBS Browser Sources, same
  // top-level-query-param pattern as `?legacy=1`. This ordering is exactly
  // what keeps every public/OBS route working without login (urgent
  // security fix item 3) — DirectorAuthGate below is never even mounted
  // for these routes, not merely bypassed. It's also what guarantees the
  // public domain's root never flashes director login/dashboard: the
  // hostname check above resolves `liveView` before anything director-side
  // is reachable.
  if (liveView) {
    if (isCanalettoPublicDomain) document.title = 'CANALETTO CUP 2026';
    return <CanalettoLiveRouter view={liveView} params={params} />;
  }
  const isLegacy = params.get('legacy') === '1';
  if (isLegacy) return <PoolTournamentApp />;
  // Root/normal Canaletto director app — the ONLY route this pass gates.
  return (
    <DirectorAuthGate>
      <CanalettoApp />
    </DirectorAuthGate>
  );
}

export default App;
