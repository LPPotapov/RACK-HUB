// Realtime Database I/O for the Canaletto Cup 2026 event — thin wrappers
// over the Firebase `database` SDK (set/onValue/get), PLUS the RTDB
// round-trip codec (canalettoCloudCodec.js) applied transparently here so
// no caller (useCanalettoCloudMirror.js, CloudSyncPanel.jsx,
// useCloudPublicEvent.js, useCloudLiveState.js) needs to know RTDB
// silently reinterprets numeric-keyed objects as arrays or drops empty
// arrays — see canalettoCloudCodec.js's own header for the full
// investigation/root-cause writeup (event-blocking cloud sync fix). No
// other business logic lives here: no validation, no redaction, no
// echo-guarding, no retry policy — callers still own all of that.
//
// `live` (canalettoLive.js's CanalettoLiveState) is NOT run through the
// codec — its only dictionary-shaped field, `tvScores`, is keyed by
// tvMatchKey() strings like "ko:top16:1"/"block:A:1:167823...", never pure
// numeric strings, so it is not subject to the array-reinterpretation
// quirk.
//
// Every function is a safe no-op when `db` is null (Firebase not
// configured — see firebaseApp.js) so callers never need their own
// `if (isFirebaseConfigured)` guard before every call.

import { get, off, onValue, ref, set } from 'firebase/database';
import { db } from './firebaseApp.js';
import { LIVE_PATH, PRIVATE_STATE_PATH, PUBLIC_STATE_PATH } from './canalettoCloudPaths.js';
import {
  decodeEventFromCloud,
  decodePublicStateFromCloud,
  encodeEventForCloud,
  encodePublicStateForCloud
} from './canalettoCloudCodec.js';

const write = (path, value) => {
  if (!db) return Promise.resolve();
  return set(ref(db, path), value);
};

export const writePrivateState = (event) => write(PRIVATE_STATE_PATH, encodeEventForCloud(event));
export const writePublicState = (publicState) => write(PUBLIC_STATE_PATH, encodePublicStateForCloud(publicState));
export const writeLiveState = (liveState) => write(LIVE_PATH, liveState);

// Returns an unsubscribe function (always safe to call, even when Firebase
// isn't configured — a no-op in that case). `onData` is called with `null`
// if the path currently has no value (e.g. before the first ever publish).
const subscribe = (path, decode, onData, onError) => {
  if (!db) return () => {};
  const nodeRef = ref(db, path);
  const listener = onValue(
    nodeRef,
    (snapshot) => onData(decode(snapshot.val())),
    (error) => onError?.(error)
  );
  return () => off(nodeRef, 'value', listener);
};

export const subscribePrivateState = (onData, onError) => subscribe(PRIVATE_STATE_PATH, decodeEventFromCloud, onData, onError);
export const subscribePublicState = (onData, onError) => subscribe(PUBLIC_STATE_PATH, decodePublicStateFromCloud, onData, onError);
export const subscribeLiveState = (onData, onError) => subscribe(LIVE_PATH, (v) => v, onData, onError);

// One-shot read — used by the explicit "Load from Cloud" safeguard
// (CloudSyncPanel.jsx), never by a continuously-mounted page.
export const readPrivateStateOnce = async () => {
  if (!db) return null;
  const snapshot = await get(ref(db, PRIVATE_STATE_PATH));
  return decodeEventFromCloud(snapshot.val());
};
