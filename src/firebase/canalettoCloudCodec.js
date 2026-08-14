// Firebase Realtime Database round-trip codec (event-blocking cloud sync
// fix). RTDB has two well-known representational quirks that silently
// corrupt a CanalettoEvent/derivePublicState() payload on round trip,
// causing validateCanalettoEvent()/restoreCanalettoEvent() — and
// validatePublicState() — to reject perfectly valid data as soon as it
// comes back from the cloud:
//
//   1. An object whose keys are ALL numeric strings (e.g.
//      `tournament.rounds = {"1": [...], "2": [...]}`, keyed by round
//      number — the exact shape every canalettoEvent.js/domain function
//      requires) is silently reinterpreted by RTDB as a sparse JS ARRAY on
//      read, null-padding any "missing" indices below the highest key.
//      `validateTournamentState()` requires `rounds` to be a genuine plain
//      object — confirmed present in the real production database via
//      `firebase database:get` during investigation: `rounds` came back as
//      `[null, [...]]` instead of `{"1": [...]}`. Fixed by re-keying
//      rounds with a non-numeric prefix ("r1", "r2", ...) for the wire
//      format only; decodeRounds() strips the prefix back AND tolerates
//      the OLD (pre-fix) array-shaped corruption already sitting in the
//      database, since existing data won't self-correct until the next
//      successful write goes through this codec.
//      `preAdvanceSnapshot.allRounds` (the emergency undo-round-advance
//      buffer) has the identical round-number-keyed shape and gets the
//      same treatment.
//   2. RTDB does not store `null`, empty arrays, or empty objects at all —
//      writing one is equivalent to deleting that path entirely. A
//      genuinely empty `tables`/`pendingPlayers`/`roster`/`players` array
//      (perfectly valid locally, e.g. before any table is configured)
//      therefore reads back as completely ABSENT — confirmed in
//      production: `tables` read back as `null` and
//      `blockA.tournament.pendingPlayers` as `null`, both failing the
//      validators' UNCONDITIONAL "must be an array" checks (unlike
//      `blockATableConfirmations`/`ko`/`schedule`, which
//      validateCanalettoEvent() already treats as optional-when-present —
//      those need no fix). Fixed by defaulting these specific fields back
//      to `[]` on decode only — never on encode, so the local/authoritative
//      shape is never touched.
//
// This is PURELY a wire-format concern for canalettoCloudSync.js — the
// local/authoritative CanalettoEvent shape (localStorage, every
// canalettoEvent.js function, derivePublicState()'s own output before it
// is handed to this codec) is completely unaffected. encode/decode are the
// ONLY two places that ever see the transformed shape, and decode always
// restores the exact local contract.

const ROUND_KEY_PREFIX = 'r';

const encodeRounds = (rounds) => {
  const encoded = {};
  Object.entries(rounds || {}).forEach(([roundNumber, matches]) => {
    encoded[`${ROUND_KEY_PREFIX}${roundNumber}`] = matches;
  });
  return encoded;
};

const decodeRounds = (rounds) => {
  const decoded = {};
  if (rounds == null) return decoded;
  if (Array.isArray(rounds)) {
    // Pre-fix corrupted data still sitting in the database: RTDB
    // reinterpreted the numeric-keyed object as a sparse array. The array
    // INDEX is the original round number (index 0 is always null padding,
    // since round numbers start at 1).
    rounds.forEach((matches, index) => {
      if (matches != null) decoded[String(index)] = matches;
    });
    return decoded;
  }
  Object.entries(rounds).forEach(([key, matches]) => {
    if (matches == null) return;
    decoded[key.startsWith(ROUND_KEY_PREFIX) ? key.slice(ROUND_KEY_PREFIX.length) : key] = matches;
  });
  return decoded;
};

const encodeTournament = (tournament) => ({
  ...tournament,
  rounds: encodeRounds(tournament.rounds)
});

const decodeTournament = (tournament) => ({
  ...tournament,
  roster: tournament.roster || [],
  players: tournament.players || [],
  pendingPlayers: tournament.pendingPlayers || [],
  rounds: decodeRounds(tournament.rounds)
});

const encodeBlock = (block) => ({
  ...block,
  tournament: encodeTournament(block.tournament),
  ...(block.preAdvanceSnapshot
    ? { preAdvanceSnapshot: { ...block.preAdvanceSnapshot, allRounds: encodeRounds(block.preAdvanceSnapshot.allRounds) } }
    : {})
});

const decodeBlock = (block) => {
  if (!block) return block;
  const decoded = { ...block, tournament: decodeTournament(block.tournament) };
  if (block.preAdvanceSnapshot) {
    decoded.preAdvanceSnapshot = { ...block.preAdvanceSnapshot, allRounds: decodeRounds(block.preAdvanceSnapshot.allRounds) };
  }
  return decoded;
};

export const encodeEventForCloud = (event) => ({
  ...event,
  blockA: encodeBlock(event.blockA),
  blockB: encodeBlock(event.blockB)
});

export const decodeEventFromCloud = (raw) => {
  if (!raw) return raw;
  return {
    ...raw,
    tables: raw.tables || [],
    blockA: decodeBlock(raw.blockA),
    blockB: decodeBlock(raw.blockB)
  };
};

// publicState has no `preAdvanceSnapshot` (derivePublicState() never
// copies it) — otherwise identical treatment to the full event.
export const encodePublicStateForCloud = (publicState) => ({
  ...publicState,
  blockA: { tournament: encodeTournament(publicState.blockA.tournament) },
  blockB: { tournament: encodeTournament(publicState.blockB.tournament) }
});

export const decodePublicStateFromCloud = (raw) => {
  if (!raw) return raw;
  return {
    ...raw,
    tables: raw.tables || [],
    blockA: raw.blockA ? { tournament: decodeTournament(raw.blockA.tournament) } : raw.blockA,
    blockB: raw.blockB ? { tournament: decodeTournament(raw.blockB.tournament) } : raw.blockB
  };
};
