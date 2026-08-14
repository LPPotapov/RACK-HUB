// Director app authentication gate (urgent security fix — the deployed
// root route rendered the full Canaletto director app to anyone, with no
// sign-in required). Wraps ONLY the root/normal Canaletto director route in
// App.jsx — never the `?live=...` public/OBS routes (those are dispatched
// in App.jsx BEFORE this gate is even considered, so this component never
// mounts for them) and never the stream-staff TvScoreControlPage.jsx
// (which keeps its own separate, pre-existing director-or-stream gate).
//
// UID is authoritative, never email — reuses the SAME
// src/firebase/authorizedUsers.js classification and
// src/firebase/useFirebaseAuth.js hook every other auth-gated surface in
// this app already uses (TvScoreControlPage.jsx, CloudSyncPanel.jsx), not a
// second/parallel auth check.
//
// This is a UI GATE only — the actual data security boundary is the
// Firebase Realtime Database security rules (see docs/decisions/
// 0005-firebase-realtime-backend.md); this component is never a substitute
// for them, only the corresponding UX so an unauthorized visitor never
// even sees the director controls.
//
// LOCAL-DEV ESCAPE HATCH: if Firebase itself isn't configured at all (no
// `.env.local` — see firebaseApp.js's `isFirebaseConfigured`), the gate is
// skipped entirely and the director app renders directly, exactly as it
// did before any of the Firebase work existed. The deployed production app
// always has Firebase configured, so this only matters for local
// development without cloud credentials — without this escape hatch, a
// contributor with no `.env.local` would be permanently locked out of the
// director app with no way to ever sign in, which would break the
// documented "operator must be able to keep operating without cloud
// connectivity" invariant (docs/DEPLOYMENT.md).

import { useState } from 'react';
import { useFirebaseAuth } from '../firebase/useFirebaseAuth.js';
import { isFirebaseConfigured } from '../firebase/firebaseApp.js';
import { ActionButton } from './ui.jsx';
import batforceLogo from '../assets/batforce_orange_logo.png';

const LoadingScreen = () => (
  <div className="flex min-h-screen items-center justify-center bg-canaletto-bg">
    <div className="font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">Checking sign-in…</div>
  </div>
);

const LoginScreen = ({ auth }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = () => auth.signIn(email, password);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canaletto-bg px-4">
      <div className="w-full max-w-sm rounded border border-canaletto-border bg-canaletto-panel p-6">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={batforceLogo} alt="Batforce" className="mb-3 h-12 w-12 object-contain" />
          <div className="font-condensed text-2xl font-black uppercase tracking-wide text-canaletto-cream">RACK HUB</div>
          <div className="font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">Canaletto Cup</div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-canaletto-lavender">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-canaletto-lavender">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          <ActionButton variant="gold" className="w-full" onClick={submit}>Sign In</ActionButton>
        </div>
        {auth.error && <div className="mt-3 text-center text-xs text-canaletto-magenta">{auth.error}</div>}
      </div>
    </div>
  );
};

const AccessDenied = ({ auth }) => (
  <div className="flex min-h-screen items-center justify-center bg-canaletto-bg px-4">
    <div className="w-full max-w-sm rounded border border-canaletto-magenta/60 bg-canaletto-panel p-6 text-center">
      <div className="mb-2 font-condensed text-xl font-black uppercase tracking-wide text-canaletto-magenta">Access Denied</div>
      <div className="mb-4 text-sm text-canaletto-lavender">This account is not authorized as a tournament director.</div>
      <ActionButton variant="outline" onClick={auth.signOut}>Sign Out</ActionButton>
    </div>
  </div>
);

export const DirectorAuthGate = ({ children }) => {
  const auth = useFirebaseAuth();

  if (!isFirebaseConfigured) return children;
  if (auth.loading) return <LoadingScreen />;
  if (!auth.user) return <LoginScreen auth={auth} />;
  if (!auth.isDirector) return <AccessDenied auth={auth} />;
  return children;
};
