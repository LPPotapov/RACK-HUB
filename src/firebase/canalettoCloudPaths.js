// Realtime Database path constants for the Canaletto Cup 2026 event — the
// EXACT paths the already-configured security rules were written against
// (director correction: "Do not use top-level /privateState, /publicState,
// /live"). One source of truth so a path literal never has to be retyped
// (and risk drifting) across canalettoCloudSync.js's read/write/subscribe
// functions.
//
// EVENT NAMESPACE SELECTION (urgent testing-feature hotfix): a second,
// fully isolated `events/canalettoTest/...` namespace exists purely so the
// director can test live scoring without touching the running production
// tournament. Selection happens in EXACTLY ONE place — here, via
// resolveEventId() — rather than scattering `URLSearchParams`/
// `window.location.search` parsing anywhere else that needs a Firebase
// path; every consumer (canalettoCloudSync.js, and therefore
// useCanalettoCloudMirror.js/useCloudPublicEvent.js/useCloudLiveState.js/
// TvScoreControlPage.jsx/CloudSyncPanel.jsx) keeps importing the same three
// plain string path constants as before this hotfix, completely unaware a
// second namespace even exists.
//
// SAFETY: the default is ALWAYS the production namespace. Only the EXACT,
// explicit query value `event=test` selects the test namespace — no other
// value, case, or typo falls back to test (a safety switch must fail
// CLOSED toward production, never open toward test). Read ONCE, at module
// load — the same "read the query string once at startup" pattern this app
// already uses for `?live=`/`?legacy=1` in App.jsx (query params never
// change reactively mid-session, so a one-time read here is exactly as
// complete as re-parsing on every access would be).
const PRODUCTION_EVENT_ID = 'canaletto2026';
const TEST_EVENT_ID = 'canalettoTest';

// Exported (and kept as a pure function of an explicit `search` string,
// never reading `window` itself) so it's directly unit-testable, and so any
// other caller that needs to know which namespace is active — without
// re-parsing the query string itself — can call the SAME resolution
// (see IS_TEST_EVENT below and liveLinks.js's use of it for generated URLs).
export const resolveEventId = (search) => {
  const params = new URLSearchParams(search ?? '');
  return params.get('event') === 'test' ? TEST_EVENT_ID : PRODUCTION_EVENT_ID;
};

// `window` is absent under the plain `node --test` runner this repo's other
// tests already run under — falls back to production in that case, exactly
// like a real browser session with no query string at all.
export const CANALETTO_EVENT_ID = resolveEventId(typeof window !== 'undefined' ? window.location.search : '');
export const IS_TEST_EVENT = CANALETTO_EVENT_ID === TEST_EVENT_ID;

const EVENT_ROOT = `events/${CANALETTO_EVENT_ID}`;

export const PRIVATE_STATE_PATH = `${EVENT_ROOT}/privateState`;
export const PUBLIC_STATE_PATH = `${EVENT_ROOT}/publicState`;
export const LIVE_PATH = `${EVENT_ROOT}/live`;
