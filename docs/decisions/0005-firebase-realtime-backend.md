# ADR 0005 — Firebase Realtime Database as the interim backend/publication layer for Canaletto Cup 2026

**Status:** Accepted

## Context

`docs/DEPLOYMENT.md` and `docs/ARCHITECTURE.md` deliberately left the backend/hosting technology undecided: "no production backend stack is considered final yet," IONOS named only as a "likely" candidate, and "the implementation choice should be made only after the M2 backend/API shape is known." `docs/LIVE.md` similarly deferred "the exact hosting/synchronization technology... until the local API/state model is stable." Until this decision, the app was pure browser-local: `useCanalettoEvent.js`/`useCanalettoLiveState.js` persist to `localStorage`, and every public/OBS `?live=` route only worked because it read the *same browser's* storage — there was no cross-machine reach.

For the actual Canaletto Cup 2026 event, the project owner needs cross-machine reach now — a public livescore/OBS setup that works from machines other than the director's, two directors with independent access, and a streaming operator who can switch the TV overlay without waiting on the director — well ahead of when a general-purpose M2 backend/API would otherwise be built. The project owner has provisioned a Firebase project (`rack-hub-canaletto`), a Realtime Database, and email/password Auth accounts for 2 directors + 1 stream/OBS operator, with security rules already written against a specific path shape.

## Decision

Adopt Firebase Realtime Database + Firebase Auth (email/password) + Firebase Hosting as the concrete backend/sync/hosting technology for this event. This supersedes the "IONOS likely" language in `docs/DEPLOYMENT.md` for this event's needs; it is not a claim that Firebase is RACK HUB's permanent, general-purpose backend choice beyond it.

**Data model** — three Realtime Database nodes under `events/canaletto2026/` (NOT top-level; the security rules were written against this exact nesting):

- `privateState` — the full, unmodified authoritative `CanalettoEvent` object (`src/application/canalettoEvent.js`'s existing shape, unchanged). Director read/write only.
- `publicState` — an explicit, whitelisted projection built by the new pure function `src/application/canalettoPublicState.js`'s `derivePublicState(event, liveState)`. The security rules make this node readable by anyone, so it deliberately excludes director-only operational data (`pendingPlayers`, each block's `preAdvanceSnapshot`, table integration metadata like `billardPadId`/`scoreLink`) while reusing the SAME field names/nesting as `CanalettoEvent` for everything it keeps, so the existing public page components render it with zero rendering-logic changes.
- `live` — the existing, separately-owned `canalettoLive.js` broadcast state (current TV match pointer + per-match manual stream scores). Director OR the stream/Qniverse UID may write it.

**Sync model:**

- Local `localStorage` remains the synchronous, always-available source of truth for the director's own machine — `useCanalettoEvent.js`/`useCanalettoLiveState.js` are unmodified. Cloud sync is purely additive (`useCanalettoCloudMirror.js`): while signed in as an authorized director, every local `event` change is mirrored out (debounced) to `privateState`/`publicState`, and an inbound listener applies a remote `privateState` change locally via the same `restoreCanalettoEvent()` replace-command the local JSON backup/restore feature already uses.
- **Both director UIDs may write concurrently — plain last-write-wins, no merge/lock logic** (explicit product decision; the risk of one director's edit silently overwriting the other's concurrent edit is accepted, not engineered around).
- Signed out, or Firebase not configured (no `.env.local`): the app behaves exactly as it did before this ADR — pure local operation, matching the existing "director must be able to keep operating without public connectivity" invariant.
- Two explicit safeguards (`CloudSyncPanel.jsx`, Event page) beyond the continuous mirror: **Publish to Cloud** (force-push now) and **Load from Cloud** (fetch + validate + typed-confirmation replace — same UX pattern as the local file-backup "Restore Backup").

**Hosting:** `firebase.json`/`.firebaserc` (SPA rewrite to `dist/index.html`, default project `rack-hub-canaletto`) are authored as config only. No `firebase login`/`firebase deploy` has been run as part of this change.

## Consequences

- Public/OBS pages (`useCloudPublicEvent.js`) and the TV ticker/score-control page (`useCloudLiveState.js`) now work from any machine, not just the director's own browser tab.
- `TvScoreControlPage.jsx` is now auth-gated (director or stream UID) rather than open to anyone with the link.
- The domain/application layers remain untouched: `src/domain/` and `src/application/canalettoEvent.js`/`canalettoKo.js`/`canalettoLive.js` still have zero dependency on Firebase or any network API (`src/firebase/` is a separate infrastructure layer, only ever imported from `src/canaletto/` React code) — ADR 0001/0002's boundary is preserved, just fulfilled by Firebase instead of a bespoke backend for this event.
- Firebase RTDB's own security rules are the actual enforcement boundary for who may read/write which path; this codebase's UID checks (`src/firebase/authorizedUsers.js`) only drive client-side UI gating and must never be treated as a substitute for those rules.
- A future general-purpose RACK HUB backend (M2/M6) is not required to keep using Firebase — the same replace-oriented sync pattern (`restoreCanalettoEvent`, `derivePublicState`) would carry over to a different transport with minimal change, since neither depends on the Firebase SDK itself.
