// Realtime Database path constants for Canaletto events — the EXACT paths
// the already-configured security rules were written against (director
// correction: "Do not use top-level /privateState, /publicState, /live").
// One source of truth so a path literal never has to be retyped (and risk
// drifting) across canalettoCloudSync.js's read/write/subscribe functions.
//
// EVENT NAMESPACE SELECTION — THREE known, closed contexts (URGENT
// ARCHITECTURE FIX: "bind OBS/live links to current director event"):
//
//   workspace  -> events/canalettoWorkspace/...  the CURRENT director/live/
//                 OBS runtime. DEFAULT when no `?event=` param is present
//                 at all, or when it's anything unrecognized — a director
//                 session and every link it generates normally operate
//                 here, never knowing a second/third namespace exists.
//   test       -> events/canalettoTest/...        isolated live-scoring
//                 rehearsal, selected ONLY by the exact value `?event=test`
//                 (unchanged from the original testing-feature hotfix).
//   canaletto2026 -> events/canaletto2026/...     the COMPLETED Canaletto
//                 Cup 2026 tournament — now purely historical/diagnostic
//                 data (also the source the static /2026 archive snapshot
//                 was captured from). Selected ONLY by the exact value
//                 `?event=canaletto2026`; never the implicit default.
//
// Selection happens in EXACTLY ONE place — here, via resolveEventSelector()/
// resolveEventId() — rather than scattering `URLSearchParams`/
// `window.location.search` parsing anywhere else that needs a Firebase
// path; every consumer (canalettoCloudSync.js, and therefore
// useCanalettoCloudMirror.js/useCloudPublicEvent.js/useCloudLiveState.js/
// TvScoreControlPage.jsx/CloudSyncPanel.jsx) keeps importing the same three
// plain string path constants as before, completely unaware how many
// namespaces exist.
//
// SAFETY: the mapping is CLOSED — only the two exact strings "test" and
// "canaletto2026" ever select anything other than the workspace default; no
// other value, case, typo, or arbitrary string is ever treated as a raw
// Firebase path. Before this fix, the default (no `?event=` param) silently
// resolved to the completed `canaletto2026` namespace — the same node a
// director's auto-mirror could overwrite and the same node every OBS/live
// link without an explicit selector would read, regardless of what
// tournament the director was actually running. That is the exact bug this
// fix closes: the SAFE, implicit default is now the current working
// namespace (`workspace`), and reaching the historical/completed data
// requires an explicit, deliberate `?event=canaletto2026` — the failure
// mode of an omitted/mistyped selector is now "empty workspace," never
// "silently show/overwrite the finished historical tournament."
//
// Read ONCE, at module load — the same "read the query string once at
// startup" pattern this app already uses for `?live=`/`?legacy=1` in
// App.jsx (query params never change reactively mid-session, so a one-time
// read here is exactly as complete as re-parsing on every access would be).
const EVENT_NAMESPACE_BY_SELECTOR = {
  workspace: 'canalettoWorkspace',
  test: 'canalettoTest',
  canaletto2026: 'canaletto2026'
};

const DEFAULT_EVENT_SELECTOR = 'workspace';

// Exported (and kept as a pure function of an explicit `search` string,
// never reading `window` itself) so it's directly unit-testable, and so any
// other caller that needs to know which namespace is active — without
// re-parsing the query string itself — can call the SAME resolution (see
// CURRENT_EVENT_SELECTOR below and liveLinks.js's use of it for generated
// URLs, which must always carry this SAME selector explicitly).
export const resolveEventSelector = (search) => {
  const params = new URLSearchParams(search ?? '');
  const selector = params.get('event');
  return selector && Object.prototype.hasOwnProperty.call(EVENT_NAMESPACE_BY_SELECTOR, selector) ? selector : DEFAULT_EVENT_SELECTOR;
};

export const resolveEventId = (search) => EVENT_NAMESPACE_BY_SELECTOR[resolveEventSelector(search)];

// `window` is absent under the plain `node --test` runner this repo's other
// tests already run under — falls back to the safe workspace default in
// that case too, exactly like a real browser session with no query string
// at all.
export const CURRENT_EVENT_SELECTOR = resolveEventSelector(typeof window !== 'undefined' ? window.location.search : '');
export const CANALETTO_EVENT_ID = EVENT_NAMESPACE_BY_SELECTOR[CURRENT_EVENT_SELECTOR];
export const IS_TEST_EVENT = CURRENT_EVENT_SELECTOR === 'test';
export const IS_WORKSPACE_EVENT = CURRENT_EVENT_SELECTOR === 'workspace';
export const IS_HISTORICAL_2026_EVENT = CURRENT_EVENT_SELECTOR === 'canaletto2026';

const EVENT_ROOT = `events/${CANALETTO_EVENT_ID}`;

export const PRIVATE_STATE_PATH = `${EVENT_ROOT}/privateState`;
export const PUBLIC_STATE_PATH = `${EVENT_ROOT}/publicState`;
export const LIVE_PATH = `${EVENT_ROOT}/live`;
