// TV overlay score control (LIVE milestone) — a dedicated page for the
// STREAMING team, separate from the director app, to adjust the broadcast
// score shown on TvOverlayPage.jsx. Writes ONLY to canalettoLive.js's
// independent live state (via useCloudLiveState()) — this page never
// imports canalettoEvent.js's mutating commands and has no access to them,
// so it is structurally unable to affect official tournament results, not
// merely instructed not to.
//
// Streaming-staff TV selection pass: staff run multiple cameras and need to
// switch which match is on TV themselves, without waiting for the director
// (item 1-4/6 of that pass). The selector below calls the EXACT SAME
// selectTvMatch()/getTvSelectableMatches()/isSelectedTvRow() the director's
// LIVE page uses — ONE shared `tvMatch` pointer, so whichever page picks
// last is what the ticker shows, and switching here changes ONLY that
// pointer, never any official result or table assignment (this page has no
// import path to those commands at all — see the file-level note above).
// The score itself is PER MATCH (getCurrentTvScore()/setTvScore(), keyed by
// tvMatchKey()) so switching cameras away and back restores whatever score
// was already dialled in for that match, never resets it.
//
// Canaletto Cup 2026 cloud sync pass — event/liveState now come from the
// Realtime Database (useCloudPublicEvent()/useCloudLiveState()) so this
// page works from any machine, and control itself is now AUTH-GATED: only
// a signed-in director or the stream/Qniverse UID may select a match or
// adjust the score (useCloudLiveState()'s `run()` already refuses to write
// for anyone else — the sign-in gate below is the corresponding UI, not a
// second independent check).

import { useState } from 'react';
import {
  getCurrentTvScore,
  getTvSelectableMatches,
  isSelectedTvRow,
  resolveTvMatch,
  selectTvMatch,
  setTvScore
} from '../../application/canalettoLive.js';
import { ActionButton, PageHeader, Panel } from '../ui.jsx';
import { LiveBrandMark } from './liveComponents.jsx';
import { EMPTY_PUBLIC_STATE, useCloudPublicEvent } from './useCloudPublicEvent.js';
import { useCloudLiveState } from './useCloudLiveState.js';
import { isFirebaseConfigured } from '../../firebase/firebaseApp.js';

const CenteredStatus = ({ children }) => (
  <div className="flex min-h-screen items-center justify-center bg-canaletto-bg text-canaletto-lavender">
    <div className="font-condensed text-xs font-bold uppercase tracking-widest">{children}</div>
  </div>
);

const ScoreStepper = ({ label, value, onChange }) => (
  <div className="rounded border border-canaletto-border bg-canaletto-panel p-4 text-center">
    <div className="mb-2 truncate font-condensed text-sm font-bold uppercase tracking-wide text-canaletto-lavender">{label}</div>
    <div className="flex items-center justify-center gap-3">
      <ActionButton variant="outline" className="h-10 w-10 px-0 text-lg" disabled={value <= 0} onClick={() => onChange(value - 1)}>–</ActionButton>
      <div className="w-16 font-condensed text-5xl font-black tabular-nums text-canaletto-gold">{value}</div>
      <ActionButton variant="outline" className="h-10 w-10 px-0 text-lg" onClick={() => onChange(value + 1)}>+</ActionButton>
    </div>
  </div>
);

// One key per row, works for both Block ({source,block,roundNumber,matchId})
// and KO ({source,stage,matchNumber}) rows — same helper the director's
// LivePage.jsx TvMatchSelector uses.
const rowKey = (r) => (r.source === 'ko' ? `ko-${r.stage}-${r.matchNumber}` : `block-${r.block}-${r.roundNumber}-${r.matchId}`);

// Streaming-staff selector — deliberately "TABLE · Player A vs Player B"
// first (camera crew thinks in tables, not stage/round labels), quick to
// scan and click for a live camera switch. The match currently on table
// "301 TV" (this event's main stream table) is flagged, without ever
// restricting selection to it — any current match/table remains one tap
// away, since multiple cameras exist.
const StaffTvMatchSelector = ({ event, liveState, run }) => {
  const rows = getTvSelectableMatches(event);
  const selected = liveState.tvMatch;

  return (
    <Panel title="Switch TV Match" accent="magenta" className="mb-4">
      <div className="mb-2 text-xs text-canaletto-lavender">
        Quick camera switch — pick any current match/table. This never changes official results or table assignments; only which match the overlay displays.
      </div>
      {rows.length === 0 && <div className="text-canaletto-lavender">No current Block or KO matches yet.</div>}
      <div className="space-y-1.5">
        {rows.map((r) => {
          const isSelected = isSelectedTvRow(selected, r);
          return (
            <button
              key={rowKey(r)}
              type="button"
              onClick={() => run(selectTvMatch, r)}
              className={`flex w-full items-center justify-between gap-2 rounded border px-3 py-2 text-left transition ${
                isSelected
                  ? 'border-canaletto-gold bg-canaletto-gold/10'
                  : r.isPreferredTable
                    ? 'border-canaletto-magenta/60 bg-canaletto-panel2'
                    : 'border-canaletto-border bg-canaletto-panel2 hover:border-canaletto-lavender'
              }`}
            >
              <span className="min-w-0 truncate font-condensed text-sm font-bold">
                <span className={r.isPreferredTable ? 'text-canaletto-magenta' : 'text-canaletto-gold'}>{r.tbl || 'No table'}</span>
                <span className="text-canaletto-lavender"> · </span>
                <span className="text-canaletto-cream">{r.p1Name} <span className="text-canaletto-lavender">vs</span> {r.p2Name}</span>
              </span>
              {isSelected && <span className="shrink-0 font-condensed text-[10px] font-bold uppercase tracking-wide text-canaletto-gold">On Air</span>}
            </button>
          );
        })}
      </div>
    </Panel>
  );
};

// Sign-in gate — until a director or stream UID is signed in, no match
// selector or score control renders at all (not merely disabled).
const SignInGate = ({ auth }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (auth.user && !auth.isDirector && !auth.isStream) {
    return (
      <Panel>
        <div className="mb-2 text-canaletto-magenta">Signed in as {auth.user.email}, but this account is not authorized for TV control.</div>
        <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={auth.signOut}>Sign Out</ActionButton>
      </Panel>
    );
  }

  return (
    <Panel title="Sign In Required" accent="magenta">
      <div className="mb-3 text-xs text-canaletto-lavender">Sign in as a tournament director or the authorized streaming operator to control the TV overlay.</div>
      <div className="max-w-xs space-y-2">
        <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={() => auth.signIn(email, password)}>Sign In</ActionButton>
      </div>
      {auth.error && <div className="mt-2 text-xs text-canaletto-magenta">{auth.error}</div>}
    </Panel>
  );
};

// First-load state machine (event-blocking cloud sync fix, item 8 — "fix
// tv-control so first load never renders white"): AUTH CHECK… -> SIGN IN
// (SignInGate, covers "not signed in" and "wrong account") -> LOADING LIVE
// DATA… -> normal UI, plus a standalone LIVE DATA UNAVAILABLE state when
// Firebase itself isn't configured (this page has no useful offline mode —
// unlike the director app, it has zero purpose without cloud sync).
export const TvScoreControlPage = () => {
  const event = useCloudPublicEvent();
  const { liveState, run, canWrite, auth, loaded } = useCloudLiveState();
  const resolved = resolveTvMatch(event, liveState);
  const score = getCurrentTvScore(liveState);

  if (!isFirebaseConfigured) return <CenteredStatus>Live Data Unavailable</CenteredStatus>;
  if (auth.loading) return <CenteredStatus>Auth Check…</CenteredStatus>;

  return (
    <div className="min-h-screen bg-canaletto-bg px-8 py-6 text-canaletto-cream">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center gap-3">
          <LiveBrandMark className="h-9 w-9" />
          <PageHeader eyebrow="Broadcast" title="TV Overlay Score Control" subtitle="Independent of official tournament results — for streaming staff only." />
        </div>

        {!canWrite && <SignInGate auth={auth} />}

        {canWrite && (!loaded || event === EMPTY_PUBLIC_STATE) && (
          <Panel>
            <div className="text-canaletto-lavender">Loading live data…</div>
          </Panel>
        )}

        {canWrite && loaded && event !== EMPTY_PUBLIC_STATE && (
          <>
            <StaffTvMatchSelector event={event} liveState={liveState} run={run} />

            {!resolved && (
              <Panel>
                <div className="text-canaletto-lavender">
                  No TV match selected yet. Pick a current match above, or ask the tournament director to pick one on the Canaletto app's <span className="font-semibold text-canaletto-cream">LIVE</span> tab.
                </div>
              </Panel>
            )}

            {resolved && (
              <>
                <Panel title={`${resolved.sourceLabel}${resolved.tbl ? ` — ${resolved.tbl}` : ''}`} accent="magenta">
                  <div className="mb-4 text-center font-condensed text-lg font-black uppercase text-canaletto-cream">
                    {resolved.p1.name} <span className="text-canaletto-magenta">vs</span> {resolved.p2.name}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <ScoreStepper
                      label={resolved.p1.name}
                      value={score.r1}
                      onChange={(r1) => run(setTvScore, { r1, r2: score.r2 })}
                    />
                    <ScoreStepper
                      label={resolved.p2.name}
                      value={score.r2}
                      onChange={(r2) => run(setTvScore, { r1: score.r1, r2 })}
                    />
                  </div>
                  <div className="mt-4 flex justify-center">
                    <ActionButton
                      variant="outline"
                      className="px-3 py-1 text-xs"
                      onClick={() => run(setTvScore, { r1: 0, r2: 0 })}
                    >
                      Reset to 0–0
                    </ActionButton>
                  </div>
                </Panel>
                <div className="mt-3 text-center text-xs text-canaletto-lavender">
                  This is the broadcast overlay score only, kept per match — it never reads from or writes to official tournament results.
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
