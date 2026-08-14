// Authorized Firebase Auth UIDs for the Canaletto Cup 2026 event (see
// docs/decisions/0005-firebase-realtime-backend.md). These are UIDs, not
// secrets — the ACTUAL enforcement of who may read/write which RTDB path
// lives in the already-configured Firebase Realtime Database security
// rules; this file only drives the CLIENT's own UI gating (which controls
// to show/enable), never a substitute for the server-side rules.
//
// Two directors (either may write privateState/publicState/live —
// confirmed: both may edit concurrently, plain last-write-wins, no
// merge/lock logic) plus one stream/OBS operator (TvScoreControlPage.jsx
// only — write access to `live`, nothing else).
export const DIRECTOR_UIDS = ['30O2lFXg0oXd5LUP2NS9mSy4Syz1', '9xjiDwmIBOVcjq8t3rZDzd1Fw8n1'];
export const STREAM_UID = '8dvfWIUSLfNXttv9rYGsIPICpe92';

export const isDirectorUid = (uid) => !!uid && DIRECTOR_UIDS.includes(uid);
export const isStreamUid = (uid) => !!uid && uid === STREAM_UID;
export const isAuthorizedUid = (uid) => isDirectorUid(uid) || isStreamUid(uid);
