// Firebase app/auth/database bootstrap (Canaletto Cup 2026 cloud sync pass —
// see docs/decisions/0005-firebase-realtime-backend.md). Infrastructure
// layer only: this module and everything under src/firebase/ is never
// imported by src/domain/ or src/application/ (see docs/ARCHITECTURE.md's
// domain/backend/frontend boundary — domain/application must not depend on
// HTTP/network APIs). Only React-layer code (src/canaletto/) imports this.
//
// DEFENSIVE INIT: a fresh checkout has no `.env.local` (it's git-ignored —
// see .gitignore's `*.local` rule), so `VITE_FIREBASE_API_KEY` etc. are
// legitimately absent in that case. Rather than throwing and breaking
// `npm run dev`/`build`/`test` for anyone without cloud credentials, this
// module exports `auth`/`db` as `null` when config is incomplete — every
// consumer (useFirebaseAuth.js, canalettoCloudSync.js) already treats a
// null client as "cloud sync inert," so the app keeps working exactly as
// it did before this pass: pure local/localStorage operation. This mirrors
// docs/DEPLOYMENT.md's explicit resilience requirement — the director must
// be able to keep operating even when public connectivity/cloud config is
// unavailable.

import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);

let app = null;
let auth = null;
let db = null;

if (isConfigured) {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
} else {
  console.warn('Canaletto cloud sync: VITE_FIREBASE_* env vars are not configured — running in local-only mode.');
}

export { app, auth, db, isConfigured as isFirebaseConfigured };
