// Realtime Database I/O for the Canaletto Cup 2026 event — THIN wrappers
// over the Firebase `database` SDK only (set/onValue/get). No business
// logic lives here: no validation, no redaction, no echo-guarding, no
// retry policy. Callers (useCanalettoCloudMirror.js, CloudSyncPanel.jsx,
// useCloudPublicEvent.js, useCloudLiveState.js) own all of that — this
// module's only job is "write this JSON to this path" / "call me back with
// whatever is at this path."
//
// Every function is a safe no-op when `db` is null (Firebase not
// configured — see firebaseApp.js) so callers never need their own
// `if (isFirebaseConfigured)` guard before every call.

import { get, off, onValue, ref, set } from 'firebase/database';
import { db } from './firebaseApp.js';
import { LIVE_PATH, PRIVATE_STATE_PATH, PUBLIC_STATE_PATH } from './canalettoCloudPaths.js';

const write = (path, value) => {
  if (!db) return Promise.resolve();
  return set(ref(db, path), value);
};

export const writePrivateState = (event) => write(PRIVATE_STATE_PATH, event);
export const writePublicState = (publicState) => write(PUBLIC_STATE_PATH, publicState);
export const writeLiveState = (liveState) => write(LIVE_PATH, liveState);

// Returns an unsubscribe function (always safe to call, even when Firebase
// isn't configured — a no-op in that case). `onData` is called with `null`
// if the path currently has no value (e.g. before the first ever publish).
const subscribe = (path, onData, onError) => {
  if (!db) return () => {};
  const nodeRef = ref(db, path);
  const listener = onValue(
    nodeRef,
    (snapshot) => onData(snapshot.val()),
    (error) => onError?.(error)
  );
  return () => off(nodeRef, 'value', listener);
};

export const subscribePrivateState = (onData, onError) => subscribe(PRIVATE_STATE_PATH, onData, onError);
export const subscribePublicState = (onData, onError) => subscribe(PUBLIC_STATE_PATH, onData, onError);
export const subscribeLiveState = (onData, onError) => subscribe(LIVE_PATH, onData, onError);

// One-shot read — used by the explicit "Load from Cloud" safeguard
// (CloudSyncPanel.jsx), never by a continuously-mounted page.
export const readPrivateStateOnce = async () => {
  if (!db) return null;
  const snapshot = await get(ref(db, PRIVATE_STATE_PATH));
  return snapshot.val();
};
