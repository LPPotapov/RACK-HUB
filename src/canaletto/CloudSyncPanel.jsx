// Compact director-only "Cloud Sync" control (Canaletto Cup 2026 cloud
// sync pass — see docs/decisions/0005-firebase-realtime-backend.md).
// Placed on EventPage.jsx next to BackupDataPanel, matching its same
// collapsible-panel pattern. Background mirroring itself happens in
// useCanalettoCloudMirror.js (composed once in CanalettoApp.jsx); this
// component is the sign-in UI plus the two EXPLICIT safeguards:
//
//   - Publish to Cloud — force-push the current local event now (the
//     background mirror already does this automatically on every change;
//     this is a visible, on-demand "sync now", e.g. after reconnecting).
//   - Load from Cloud — fetch the cloud's current privateState, validate
//     it (validateCanalettoEvent — the SAME validator the local-file
//     Restore Backup flow uses), show a summary, and require typing
//     "LOAD FROM CLOUD" before REPLACING the local event via the SAME
//     restoreCanalettoEvent() pure command BackupControls.jsx's file
//     restore already uses. Never a silent/automatic replace.
//
// `auth` is the object returned by useCanalettoCloudMirror() in
// CanalettoApp.jsx — ONE Firebase Auth subscription shared between the
// background mirror and this panel, not a second one.

import { useState } from 'react';
import { getBlockStatus, getCurrentKoStage, getKoChampion, validateCanalettoEvent } from '../application/canalettoEvent.js';
import { restoreCanalettoEvent } from '../application/canalettoBackup.js';
import { derivePublicState } from '../application/canalettoPublicState.js';
import { KO_STAGE_LABEL } from '../application/canalettoKo.js';
import { readPrivateStateOnce, writePrivateState, writePublicState } from '../firebase/canalettoCloudSync.js';
import { isFirebaseConfigured } from '../firebase/firebaseApp.js';
import { ActionButton, Panel } from './ui.jsx';
import { TypedConfirmModal } from './TypedConfirmModal.jsx';

const koStatusLabel = (event) => {
  if (getKoChampion(event)) return 'Complete';
  const stage = getCurrentKoStage(event);
  return stage ? `${KO_STAGE_LABEL[stage]} in progress` : 'Not started';
};

const LOAD_PHRASE = 'LOAD FROM CLOUD';

export const CloudSyncPanel = ({ event, run, auth }) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [publishStatus, setPublishStatus] = useState(null); // 'publishing' | 'published' | null
  const [loadError, setLoadError] = useState(null);
  const [pendingLoad, setPendingLoad] = useState(null); // validated remote event awaiting typed confirmation

  if (!isFirebaseConfigured) {
    return (
      <div className="mb-4">
        <span className="text-xs text-canaletto-lavender">Cloud sync not configured (no Firebase environment variables).</span>
      </div>
    );
  }

  const handlePublish = async () => {
    setPublishStatus('publishing');
    await writePrivateState(event);
    await writePublicState(derivePublicState(event, null));
    setPublishStatus('published');
    setTimeout(() => setPublishStatus(null), 1500);
  };

  const handleLoad = async () => {
    setLoadError(null);
    const remoteEvent = await readPrivateStateOnce();
    if (!remoteEvent) {
      setLoadError('Nothing has been published to the cloud yet.');
      return;
    }
    const result = validateCanalettoEvent(remoteEvent);
    if (!result.valid) {
      setLoadError(`Cloud event failed validation:\n${result.errors.join('\n')}`);
      return;
    }
    setPendingLoad(remoteEvent);
  };

  return (
    <div className="mb-4">
      <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={() => setOpen((o) => !o)}>
        Cloud Sync
      </ActionButton>

      {open && (
        <Panel title="Cloud Sync" accent="magenta" compact className="mt-2 max-w-md">
          {!auth.user && (
            <div>
              <div className="mb-3 text-xs text-canaletto-lavender">Sign in as an authorized director to enable live cross-machine sync.</div>
              <div className="space-y-2">
                <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <ActionButton
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() => auth.signIn(email, password)}
                >
                  Sign In
                </ActionButton>
              </div>
              {auth.error && <div className="mt-2 text-xs text-canaletto-magenta">{auth.error}</div>}
            </div>
          )}

          {auth.user && !auth.isDirector && (
            <div>
              <div className="mb-2 text-xs text-canaletto-magenta">Signed in as {auth.user.email}, but this account is not an authorized director. Cloud sync stays disabled.</div>
              <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={auth.signOut}>Sign Out</ActionButton>
            </div>
          )}

          {auth.user && auth.isDirector && (
            <div>
              <div className="mb-3 text-xs text-canaletto-lavender">
                Signed in as <span className="font-semibold text-canaletto-cream">{auth.user.email}</span> — every local change now mirrors to the cloud automatically.
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={handlePublish}>
                  {publishStatus === 'publishing' ? 'Publishing…' : publishStatus === 'published' ? 'Published ✓' : 'Publish to Cloud'}
                </ActionButton>
                <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={handleLoad}>
                  Load from Cloud
                </ActionButton>
                <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={auth.signOut}>
                  Sign Out
                </ActionButton>
              </div>
              {loadError && <div className="mt-2 whitespace-pre-line text-xs text-canaletto-magenta">{loadError}</div>}
            </div>
          )}
        </Panel>
      )}

      {pendingLoad && (
        <TypedConfirmModal
          title="Load Tournament From Cloud"
          warning={
            <div>
              <div className="mb-2">
                This REPLACES the entire current tournament with the cloud's version — both blocks, the KO bracket, tables, and settings. The current local state is not merged or kept; this cannot be undone.
              </div>
              <div className="rounded border border-canaletto-border bg-canaletto-panel2 p-2 text-xs text-canaletto-cream">
                <div>Block A: {getBlockStatus(pendingLoad, 'A')}</div>
                <div>Block B: {getBlockStatus(pendingLoad, 'B')}</div>
                <div>KO: {koStatusLabel(pendingLoad)}</div>
              </div>
            </div>
          }
          phrase={LOAD_PHRASE}
          confirmLabel="Load"
          onConfirm={() => run(restoreCanalettoEvent, pendingLoad)}
          onClose={() => setPendingLoad(null)}
        />
      )}
    </div>
  );
};
