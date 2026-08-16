import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addPlayerToBlock,
  canStartKoStage,
  createCanalettoEvent,
  getKoChampion,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  setEventTables,
  startBlock,
  startKoStage,
  startTop16
} from '../src/application/canalettoEvent.js';
import { createCanalettoLiveState, getLiveDraftScore, setLiveDraftScore, tvMatchKey } from '../src/application/canalettoLive.js';
import { derivePublicState } from '../src/application/canalettoPublicState.js';
import { decodePublicStateFromCloud, encodePublicStateForCloud } from '../src/firebase/canalettoCloudCodec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Urgent KO-livescore-fix pass: Top16 live-draft publishing worked; QF/SF/
// Final did not, because Top16Page.jsx's non-Top16 <MatchGrid> render branch
// (used for every stage except Top16) omitted the `liveRun` prop — so
// MatchGrid's onDraftChange/onDraftClear were unconditionally `undefined`
// for QF/SF/Final, and KoMatchCard's publishDraftScoreChange() call is a
// complete no-op whenever `onPublish` is undefined (by design — see
// scoreEntry.js). The fix is the one missing `liveRun={liveRun}` prop; the
// underlying mechanism (publishDraftScoreChange -> setLiveDraftScore ->
// tvMatchKey -> Firebase publicState -> getLiveDraftScore) was already
// stage-agnostic and already fully correct for every KO stage — these tests
// prove that mechanism end-to-end for QF/SF/Final, not just Top16.
// ---------------------------------------------------------------------------

const rosterOf = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `Player ${offset + i + 1}`, elo: 1500 + (n - i) }));
const tablesOf = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, label: `Table ${i + 1}` }));

const readyForTop16 = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(12));
  rosterOf(16).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  rosterOf(16, 100).forEach((p) => { event = addPlayerToBlock(event, 'B', p); });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  ['A', 'B'].forEach((block) => {
    event[`block${block}`].tournament.rounds[1].forEach((m) => {
      event = recordBlockMatchResult(event, block, { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
    });
  });
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');
  return event;
};

const winEveryMatch = (event, stage, r1 = 7, r2 = 0) => {
  let next = event;
  next.ko[stage].matches.forEach((m) => {
    next = recordKoResult(next, stage, { matchNumber: m.matchNumber, r1, r2 });
  });
  return next;
};

// Advances the bracket so `stage` is the CURRENT active stage — every
// earlier stage confirmed, `stage` itself entirely untouched (every match
// still unconfirmed) — exactly the mid-stage state a director operates in.
const readyForStage = (stage) => {
  let event = startTop16(readyForTop16());
  if (stage === 'top16') return event;
  event = winEveryMatch(event, 'top16');
  event = startKoStage(event, 'quarterfinals');
  if (stage === 'quarterfinals') return event;
  event = winEveryMatch(event, 'quarterfinals');
  event = startKoStage(event, 'semifinals');
  if (stage === 'semifinals') return event;
  event = winEveryMatch(event, 'semifinals');
  return startKoStage(event, 'final');
};

const publicRoundTrip = (publicState) => decodePublicStateFromCloud(encodePublicStateForCloud(publicState));

const KO_STAGES = ['top16', 'quarterfinals', 'semifinals', 'final'];

// ---------------------------------------------------------------------------
// LIVE DRAFT — every KO stage, not just Top16
// ---------------------------------------------------------------------------

KO_STAGES.forEach((stage) => {
  test(`${stage}: a live draft score publishes via the same setLiveDraftScore/getLiveDraftScore mechanism as Top16, and survives the public/Firebase round trip`, () => {
    const event = readyForStage(stage);
    const match = event.ko[stage].matches[0];
    const pointer = { source: 'ko', stage, matchNumber: match.matchNumber };

    let liveState = createCanalettoLiveState();
    liveState = setLiveDraftScore(liveState, pointer, { r1: 3, r2: 2 });

    // Canonical key — identical shape for every stage (matchNumber-based,
    // never a stage-specific field), matching tvMatchKey()'s own contract.
    const key = tvMatchKey(pointer);
    assert.equal(key, `ko:${stage}:${match.matchNumber}`);
    assert.deepEqual(Object.keys(liveState.liveDraftScores), [key]);

    const publicState = publicRoundTrip(derivePublicState(event, liveState));
    const draft = getLiveDraftScore(publicState, pointer);
    assert.ok(draft, `${stage} draft must be findable on the public projection after the round trip`);
    assert.equal(draft.r1, 3);
    assert.equal(draft.r2, 2);
  });

  test(`${stage}: publishing a live draft never sets match.done, never changes the stored bracket, and never unlocks the next stage`, () => {
    const event = readyForStage(stage);
    const before = JSON.stringify(event.ko);

    let liveState = createCanalettoLiveState();
    event.ko[stage].matches.forEach((m) => {
      // Draft every match in the stage at a winning race-to score.
      liveState = setLiveDraftScore(liveState, { source: 'ko', stage, matchNumber: m.matchNumber }, { r1: 9, r2: 0 });
    });

    // The authoritative event is a completely separate object graph from
    // liveState — setLiveDraftScore() never touches `event` at all.
    assert.equal(JSON.stringify(event.ko), before);
    assert.ok(event.ko[stage].matches.every((m) => !m.done));

    const nextStageIdx = KO_STAGES.indexOf(stage) + 1;
    const nextStage = KO_STAGES[nextStageIdx];
    if (nextStage) {
      assert.equal(canStartKoStage(event, nextStage).ok, false, `${nextStage} must not be startable off drafted-but-unconfirmed ${stage} results`);
    }
  });
});

// ---------------------------------------------------------------------------
// FINAL / CHAMPION — a live draft reaching the race target must never
// produce a champion; only a CONFIRMED Final does.
// ---------------------------------------------------------------------------

test('Final: a live draft at the winning race-to score does not create a champion (director-side event)', () => {
  const event = readyForStage('final');
  const match = event.ko.final.matches[0];
  let liveState = createCanalettoLiveState();
  liveState = setLiveDraftScore(liveState, { source: 'ko', stage: 'final', matchNumber: match.matchNumber }, { r1: 9, r2: 6 });

  assert.equal(getKoChampion(event), null);
  // liveState is irrelevant to getKoChampion() — it only ever reads
  // event.ko.final, proving the draft cannot leak into champion derivation
  // regardless of what liveState holds.
  void liveState;
});

test('Final: a live draft at the winning race-to score does not create a champion on the PUBLIC projection either', () => {
  const event = readyForStage('final');
  const match = event.ko.final.matches[0];
  let liveState = createCanalettoLiveState();
  liveState = setLiveDraftScore(liveState, { source: 'ko', stage: 'final', matchNumber: match.matchNumber }, { r1: 9, r2: 6 });

  const publicState = publicRoundTrip(derivePublicState(event, liveState));
  // Draft IS visible on the public projection (live display)...
  assert.deepEqual(getLiveDraftScore(publicState, { source: 'ko', stage: 'final', matchNumber: match.matchNumber }), { r1: 9, r2: 6, updatedAt: liveState.liveDraftScores[tvMatchKey({ source: 'ko', stage: 'final', matchNumber: match.matchNumber })].updatedAt });
  // ...but getKoChampion() on that SAME public projection is still null —
  // the public page's champion banner uses the authoritative result, not
  // the draft.
  assert.equal(getKoChampion(publicState), null);
});

test('Final: a CONFIRMED result (Confirm pressed) DOES create the correct champion, director-side and on the public projection', () => {
  const event = readyForStage('final');
  const match = event.ko.final.matches[0];
  const confirmed = recordKoResult(event, 'final', { matchNumber: match.matchNumber, r1: 9, r2: 6 });

  const champion = getKoChampion(confirmed);
  assert.ok(champion);
  assert.equal(champion.playerId, match.p1.playerId);
  assert.equal(champion.r1, 9);
  assert.equal(champion.r2, 6);

  const publicState = publicRoundTrip(derivePublicState(confirmed, null));
  const publicChampion = getKoChampion(publicState);
  assert.deepEqual(publicChampion, champion);
});

// ---------------------------------------------------------------------------
// Source-scan regressions — this repo's `node --test` runner has no DOM/
// React renderer (see scoreEntry.js/canaletto-live.test.js's own notes), so
// the actual prop-wiring bugs this pass fixed are guarded at the source
// level, same convention as canaletto-live.test.js's existing public-page
// scope guard.
// ---------------------------------------------------------------------------

test('Top16Page.jsx: every <MatchGrid> render (Top16 slots AND the QF/SF/Final branch) passes liveRun through — regression guard for the exact "QF/SF/Final never publish a draft" bug', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/pages/Top16Page.jsx'), 'utf8');
  const matchGridCalls = source.match(/<MatchGrid\b[\s\S]*?\/>/g);
  assert.ok(matchGridCalls && matchGridCalls.length >= 3, 'expected 3 <MatchGrid> render sites (Top16 Slot 1, Top16 Slot 2, QF/SF/Final)');
  matchGridCalls.forEach((call, i) => {
    assert.ok(/liveRun=\{liveRun\}/.test(call), `<MatchGrid> render site #${i + 1} must pass liveRun={liveRun}:\n${call}`);
  });
});

test('LivescorePage.jsx: Top16 section derives champion via getKoChampion() and renders the shared ChampionBanner — no separate champion logic', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/live/LivescorePage.jsx'), 'utf8');
  assert.ok(source.includes("getKoChampion"), 'must reuse the authoritative getKoChampion() derivation');
  assert.ok(source.includes('ChampionBanner'), 'must reuse the shared ChampionBanner component');
  assert.ok(/<ChampionBanner\s+champion=\{champion\}\s*\/>/.test(source), 'must render <ChampionBanner champion={champion} />');
});
