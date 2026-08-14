// Compact director-only "Cloud Sync" control (Canaletto Cup 2026 cloud
// sync pass — see docs/decisions/0005-firebase-realtime-backend.md, and
// the fresh-empty-tournament hotfix for the notPublished/active sync-mode
// model). Placed on EventPage.jsx next to BackupDataPanel (wrapped in
// CloudErrorBoundary there), matching its same collapsible-panel pattern.
// Background mirroring itself happens in useCanalettoCloudMirror.js
// (composed once in CanalettoApp.jsx); this component is the sign-in UI
// plus:
//
//   - CLOUD EMPTY notice (syncMode === 'notPublished', remoteStatus ===
//     'empty') — a brand-new local tournament is NEVER auto-published;
//     this state is normal and expected for a fresh start. "Publish
//     Current to Cloud" is offered but never required to keep working
//     locally.
//   - INVALID CLOUD STATE warning (remoteStatus === 'invalid') — the
//     background listener received a malformed remoteEvent and refused to
//     touch local state (see useCanalettoCloudMirror.js). Same "Publish
//     Current to Cloud" action doubles as the repair here.
//   - Publish Current to Cloud — validates the local event, then writes it
//     (unmodified) to privateState + derivePublicState() to publicState.
//     Typed-confirmation gated (this OVERWRITES whatever is in the cloud).
//   - Load from Cloud — fetch the cloud's current privateState, validate
//     it, show a summary, and require typing "LOAD FROM CLOUD" before
//     REPLACING the local event via the SAME restoreCanalettoEvent() pure
//     command BackupControls.jsx's file restore already uses.
//
// `auth` is the object returned by useCanalettoCloudMirror() in
// CanalettoApp.jsx — ONE Firebase Auth subscription (plus remoteStatus/
// syncMode/cloudErrors/publishToCloud) shared between the background
// mirror and this panel, not a second one.

import { useState } from 'react';
import { getBlockStatus, getCurrentKoStage, getKoChampion, validateCanalettoEvent } from '../application/canalettoEvent.js';
import { restoreCanalettoEvent } from '../application/canalettoBackup.js';
import { KO_STAGE_LABEL } from '../application/canalettoKo.js';
import { readPrivateStateOnce } from '../firebase/canalettoCloudSync.js';
import { isFirebaseConfigured } from '../firebase/firebaseApp.js';
import { ActionButton, Panel } from './ui.jsx';
import { TypedConfirmModal } from './TypedConfirmModal.jsx';

const koStatusLabel = (event) => {
  if (getKoChampion(event)) return 'Complete';
  const stage = getCurrentKoStage(event);
  return stage ? `${KO_STAGE_LABEL[stage]} in progress` : 'Not started';
};

const LOAD_PHRASE = 'LOAD FROM CLOUD';
const PUBLISH_PHRASE = 'PUBLISH TO CLOUD';

export const CloudSyncPanel = ({ event, run, auth }) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [pendingLoad, setPendingLoad] = useState(null); // validated remote event awaiting typed confirmation
  const [pendingPublish, setPendingPublish] = useState(false);

  if (!isFirebaseConfigured) {
    return (
      <div className="mb-4">
        <span className="text-xs text-canaletto-lavender">Cloud sync not configured (no Firebase environment variables).</span>
      </div>
    );
  }

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
              {auth.remoteStatus === 'loading' && (
                <div className="mb-3 text-xs text-canaletto-lavender">Checking cloud status…</div>
              )}

              {auth.remoteStatus === 'empty' && auth.syncMode === 'notPublished' && (
                <div className="mb-3 rounded border border-canaletto-border bg-canaletto-panel2 p-2">
                  <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">Cloud Empty</div>
                  <div className="text-[11px] text-canaletto-lavender">
                    No tournament has been published yet — this is a normal starting state. Your local tournament keeps working exactly as before; nothing is sent to the cloud automatically. Press "Publish Current to Cloud" when you're ready to make this the live event.
                  </div>
                </div>
              )}

              {auth.syncMode === 'active' && auth.remoteStatus === 'valid' && (
                <div className="mb-3 text-xs text-canaletto-lavender">
                  Signed in as <span className="font-semibold text-canaletto-cream">{auth.user.email}</span> — every local change now mirrors to the cloud automatically.
                </div>
              )}

              {auth.remoteStatus === 'invalid' && (
                <div className="mb-3 rounded border border-canaletto-magenta/60 bg-canaletto-magenta/10 p-2">
                  <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-magenta">Invalid Cloud State</div>
                  <div className="mb-2 whitespace-pre-line text-[11px] text-canaletto-lavender">
                    The cloud's tournament data failed validation and was NOT applied — your local tournament is untouched.{'\n'}{auth.cloudErrors.join('\n')}
                  </div>
                </div>
              )}

              {auth.cloudStatus === 'ok' && auth.cloudErrors.length > 0 && (
                <div className="mb-3 rounded border border-canaletto-magenta/60 bg-canaletto-magenta/10 p-2">
                  <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-magenta">Cloud Publish Blocked — Local Event Failed Validation</div>
                  <div className="whitespace-pre-line text-[11px] text-canaletto-lavender">{auth.cloudErrors.join('\n')}</div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <ActionButton variant={auth.syncMode === 'notPublished' ? 'gold' : 'outline'} className="px-3 py-1 text-xs" onClick={() => setPendingPublish(true)}>
                  Publish Current to Cloud
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

      {pendingPublish && (
        <TypedConfirmModal
          title="Publish Current Tournament To Cloud"
          warning={
            <div>
              <div className="mb-2">
                This OVERWRITES the cloud's tournament data with your LOCAL tournament — both blocks, the KO bracket, tables, and settings. It never reads from or modifies your local tournament. Use this for the first publish of a new event, to force a re-sync, or to repair an invalid cloud state.
              </div>
              <div className="rounded border border-canaletto-border bg-canaletto-panel2 p-2 text-xs text-canaletto-cream">
                <div>Block A: {getBlockStatus(event, 'A')}</div>
                <div>Block B: {getBlockStatus(event, 'B')}</div>
                <div>KO: {koStatusLabel(event)}</div>
              </div>
            </div>
          }
          phrase={PUBLISH_PHRASE}
          confirmLabel="Publish"
          onConfirm={() => auth.publishToCloud()}
          onClose={() => setPendingPublish(false)}
        />
      )}
    </div>
  );
};
