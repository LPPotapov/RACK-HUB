// Route-entry wrapper for the Firebase-backed live/public router (archive-
// isolation fix) — a single default-exported component so App.jsx can
// React.lazy(() => import(...)) this ONE module as the real dynamic-import
// boundary, without changing CanalettoLiveRouter.jsx's existing named-
// export shape (left completely untouched — zero risk to its own
// behavior/tests). Renders the exact same CanalettoLiveRouter with the
// exact same props; no behavior change.
import { CanalettoLiveRouter } from './CanalettoLiveRouter.jsx';

const CanalettoLiveEntry = ({ view, params }) => <CanalettoLiveRouter view={view} params={params} />;

export default CanalettoLiveEntry;
