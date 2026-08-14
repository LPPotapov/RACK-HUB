import CanalettoApp from './canaletto/CanalettoApp.jsx';
import PoolTournamentApp from './PoolTournamentApp.jsx';
import { CanalettoLiveRouter } from './canaletto/live/CanalettoLiveRouter.jsx';
import { DirectorAuthGate } from './canaletto/DirectorAuthGate.jsx';

function App() {
  const params = new URLSearchParams(window.location.search);
  const liveView = params.get('live');
  // LIVE/public/OBS routes (see liveLinks.js) are dispatched BEFORE the
  // legacy/CanalettoApp choice below — they render with no director chrome
  // (and, critically, no director auth gate) at all, since they're meant to
  // be opened as their own browser tabs/OBS Browser Sources, same
  // top-level-query-param pattern as `?legacy=1`. This ordering is exactly
  // what keeps every public/OBS route working without login (urgent
  // security fix item 3) — DirectorAuthGate below is never even mounted
  // for these routes, not merely bypassed.
  if (liveView) return <CanalettoLiveRouter view={liveView} params={params} />;
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
