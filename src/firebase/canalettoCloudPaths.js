// Realtime Database path constants for the Canaletto Cup 2026 event — the
// EXACT paths the already-configured security rules were written against
// (director correction: "Do not use top-level /privateState, /publicState,
// /live"). One source of truth so a path literal never has to be retyped
// (and risk drifting) across canalettoCloudSync.js's read/write/subscribe
// functions.
const EVENT_ROOT = 'events/canaletto2026';

export const PRIVATE_STATE_PATH = `${EVENT_ROOT}/privateState`;
export const PUBLIC_STATE_PATH = `${EVENT_ROOT}/publicState`;
export const LIVE_PATH = `${EVENT_ROOT}/live`;
