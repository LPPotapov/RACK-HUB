// Route-entry wrapper for the director app (archive-isolation fix) — the
// ONE place App.jsx reaches into the Firebase-backed director branch, as a
// single dynamic-import boundary (React.lazy(() => import(...)) in
// App.jsx) rather than the two separate static imports (DirectorAuthGate +
// CanalettoApp) it used before. Renders the EXACT SAME structure App.jsx's
// director branch always has — no behavior change, just moved behind one
// import() so Rollup emits it as its own chunk, never fetched or evaluated
// for canaletto.bc-joes.de's landing/archive routes. Default export
// (required by React.lazy's module.default convention).
import CanalettoApp from './CanalettoApp.jsx';
import { DirectorAuthGate } from './DirectorAuthGate.jsx';

const CanalettoDirectorEntry = () => (
  <DirectorAuthGate>
    <CanalettoApp />
  </DirectorAuthGate>
);

export default CanalettoDirectorEntry;
