// React auth state for the Canaletto Cup 2026 cloud sync pass — a thin
// wrapper over Firebase Auth email/password sign-in (the method the
// director confirmed for all 3 provisioned UIDs), classified against
// authorizedUsers.js. Used by both CloudSyncPanel.jsx (director app) and
// TvScoreControlPage.jsx (director OR stream) — each applies its own
// stricter gate on top of `isDirector`/`isStream`.

import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from './firebaseApp.js';
import { isDirectorUid, isStreamUid } from './authorizedUsers.js';

export const useFirebaseAuth = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!auth);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!auth) return undefined;
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async (email, password) => {
    if (!auth) return false;
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }, []);

  const signOut = useCallback(() => {
    if (!auth) return;
    firebaseSignOut(auth);
  }, []);

  const uid = user?.uid ?? null;

  return {
    user,
    uid,
    loading,
    error,
    clearError: () => setError(null),
    isDirector: isDirectorUid(uid),
    isStream: isStreamUid(uid),
    signIn,
    signOut
  };
};
