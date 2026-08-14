import CanalettoApp from './canaletto/CanalettoApp.jsx';
import PoolTournamentApp from './PoolTournamentApp.jsx';
import { CanalettoLiveRouter } from './canaletto/live/CanalettoLiveRouter.jsx';

function App() {
  const params = new URLSearchParams(window.location.search);
  const liveView = params.get('live');
  // LIVE/public/OBS routes (see liveLinks.js) are dispatched BEFORE the
  // legacy/CanalettoApp choice below — they render with no director chrome
  // at all, since they're meant to be opened as their own browser tabs/OBS
  // Browser Sources, same top-level-query-param pattern as `?legacy=1`.
  if (liveView) return <CanalettoLiveRouter view={liveView} params={params} />;
  const isLegacy = params.get('legacy') === '1';
  return isLegacy ? <PoolTournamentApp /> : <CanalettoApp />;
}

export default App;
