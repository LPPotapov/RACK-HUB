import CanalettoApp from './canaletto/CanalettoApp.jsx';
import PoolTournamentApp from './PoolTournamentApp.jsx';

function App() {
  const isLegacy = new URLSearchParams(window.location.search).get('legacy') === '1';
  return isLegacy ? <PoolTournamentApp /> : <CanalettoApp />;
}

export default App;
