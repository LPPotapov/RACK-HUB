// Static, Firebase-free archive of the completed Canaletto Cup 2026 —
// canaletto.bc-joes.de/2026 (see docs task "TRUE 2026 STATIC ARCHIVE").
// Renders the SAME LivescorePresentation the Firebase-backed LivescorePage
// uses, fed from a bundled JSON snapshot of the final production
// publicState instead of a live subscription. Imports LivescorePresentation
// from its OWN dedicated module (LivescorePresentation.jsx), never from
// LivescorePage.jsx — LivescorePage.jsx also imports useCloudPublicEvent.js/
// firebaseApp.js for its live subscription, and ES module imports execute a
// file's entire top-level dependency graph, so importing the presentation
// FROM that file would transitively load and initialize Firebase here too,
// even though nothing in this page ever calls it (archive isolation fix).
// Importing from LivescorePresentation.jsx directly means there is no
// listener to mount and no network round trip: the import below is a
// synchronous, build-time-bundled JSON module, so the FIRST render already
// has the complete, final tournament — no "Tournament Not Live Yet" state
// is reachable, and nothing is ever replaced once mounted.
//
// The snapshot itself (src/canaletto/archive/canalettoCup2026.json) was
// captured by a one-time read of production's
// /events/canaletto2026/publicState — the exact node
// useCloudPublicEvent.js's live subscription reads — decoded through the
// SAME canalettoCloudCodec.js RTDB codec, validated with
// validatePublicState(), and had its one transient field
// (`liveDraftScores`) cleared to `{}`. Every official field (rosters,
// confirmed round/match results, standings, qualification, Top16/QF/SF/
// Final, champion) is the real captured production data, unmodified.
import archiveData from '../archive/canalettoCup2026.json';
import { LivescorePresentation } from './LivescorePresentation.jsx';

export const CanalettoArchive2026Page = () => <LivescorePresentation event={archiveData} archived />;
