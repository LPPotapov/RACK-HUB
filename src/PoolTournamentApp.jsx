// Pool Tournament App v1.92 - PAIRING OPTIMIZATION
//
// v1.92 revision (14.1 review): Point Diff tiebreaker + format-aware standings
//   labels; round/All-Rounds tables show this-round GD/HS/PERF in 14.1 mode;
//   final table uses P+/P-/Point Diff/GD/HGD/HS (NPD dropped); image export removed;
//   14.1 weight preset set to 60/30/10; format-aware Tournament overview; CSV now
//   includes an Individual Matches section with per-match GBR before/after/change;
//   button palette calmed (amber = manual override/warning, slate = secondary).
//
// v1.92: Added GBR_14.1 Experimental straight-pool tournament mode.
//   * New tournament format selector: "fixed_rack" (default, unchanged) or
//     "straight_pool_14_1" (experimental 14.1 / straight-pool club championship).
//   * 14.1 mode uses score, innings, and high runs to build a 14.1-specific
//     performance signal (S_14_1), tiered race targets after Round 1, an
//     experimental GBR_14.1 rating update, NPD-based standings, and 14.1 exports.
//   * Clearly flagged "GBR_14.1 Experimental" — NOT presented as calibrated/final.
//   * All existing fixed-rack behavior is preserved and remains the default.
//
// === BBS v1.91 WHITEPAPER ALIGNMENT — VERIFICATION NOTES ===
// (General Billiards Rating = GBR; the internal `elo` fields are the GBR values.)
//  * PERF cap (§4.3): 6-0 with d=330 -> opponent + 3d = opponent + 990;
//    0-6 -> opponent - 990. See calcPerformanceElo (±3*config.d).
//  * Bye (§9.3): awards exactly 1 MP, +1 game (Prestige participation), and NO
//    racks / NO GBR change / NO PERF. Bye match stored as r1=0,r2=0,bye=true so it
//    is never shown or scored as a 6-0 result. Round columns show a bye as "1".
//  * Repeated byes (§9.2): illegal. If no eligible bye player exists, createPairings
//    returns null and a modal tells the director to reduce rounds / add a player /
//    resolve manually. New players stay protected from a first-round bye.
//  * Standard pairing cost (§8.9): C = Prep + 10000*ΔMP + ΔPERF. No rankGap, no RD.
//  * Pairing order (§8.8): MP -> PERF -> ID. RD excluded from standard pairing.
//  * Final standings: Classic = MP -> PERF; Rack Differential = MP -> RD -> PERF.
//    Final table sorts by the selected mode (compareRankings).
//  * Event Score (§7.11, internally calcRank/use_rank): optional reporting metric
//    only; RDnorm = clamp(RD/RD_max, 0, 1). Does NOT affect pairing or standings.
//  * Exports use GBR / Prestige / Event Score terminology; updated DB = Name,GBR.
// === END VERIFICATION NOTES ===
//
// REFINEMENTS (v1.91 - Latest):
// - UPDATED: Rank metric now uses philosophy-first formula (0-100 scale)
//   * Rank = round(100 * (0.70*MP/R + 0.20*RD_norm + 0.10*Perf_norm) * FieldFactor)
//   * MP/R = match point rate, RD_norm = rack differential normalized to [0,1]
//   * Perf_norm = performance vs field average, clamped to [0,1]
//   * FieldFactor = avgEloField / avgEloClub (field strength adjustment)
//   * Weighs match points (70%), rack differential (20%), performance (10%)
//   * Adjusts for field strength relative to club database average
//   * Enable Event Score toggle in tournament setup (config.use_rank)
//   * Displayed only in Final Table, not in round view or live standings
//   * Shown alongside Prestige (renamed from "RP" / "Ranking Points")
//   * Prestige = purple, Rank = cyan for visual distinction
//   * Included in CSV exports (Prestige and Rank columns)
//   * Does not affect pairing, ranking, or tiebreaking logic
// - ADDED: Club database included in autosave/crash recovery
//   * Loaded club database now persists through crashes
//   * Required for Rank field strength calculation (avgEloClub)
// - FIXED: Pairing order now fully separated from final standings order
//   * Added comparePairingOrder() - sorts by MP -> Performance only
//   * Pairing order: MP -> Performance (same in both Classic and Rack modes)
//   * Final standings: Classic (MP -> Perf), Rack (MP -> Rack Diff -> Perf)
//   * Rack differential no longer influences pairing through rankGap
//   * All pairing operations use comparePairingOrder: nextRound, regenerateRound, 
//     removePlayersFromRound, restorePlayer, performDeletePlayer
//   * Final standings/exports still use compareRankings for correct display
// - IMPROVED: Pairing cost function now performance-based
//   * Removed rack differential from pairing cost (kept in standings only)
//   * Pairing cost (§8.9): repeatPenalty + mpGap*10000 + perfGap (no rankGap, no RD)
//   * perfGap = abs((p1.avgPerf || p1.elo) - (p2.avgPerf || p2.elo))
//   * Rack differential still used in Rack mode standings (MP -> Rack Diff -> Perf)
//   * Classic mode standings unchanged (MP -> Perf)
//   * Performance reflects opponent strength better than rack differential
//   * Prevents pairing distortion from early blowouts against weak opponents
//
// REFINEMENTS (v1.90):
// - ADDED: Emergency "Undo Advance" / "Cancel Current Round" feature
//   * Saves snapshot of exact tournament state before "Next Round" is pressed
//   * Emergency button appears in Round view when snapshot exists
//   * Styled as destructive/danger action (red/yellow background)
//   * Opens React confirmation modal warning about data loss
//   * Reverts to exact pre-advance state: tournament, rounds, standings, pending players
//   * Clears snapshot after successful revert (single-use, not an undo stack)
//   * Snapshot included in autosave for crash recovery
//   * Useful when TD notices error immediately after advancing to new round
// - ADDED: Emergency clear autosave button
//   * Located inside Club Database modal (low position to prevent accidental clicks)
//   * Styled as destructive/danger action (red background)
//   * Opens React confirmation modal (not browser confirm)
//   * Removes localStorage recovery data without affecting current session
//   * Shows success message via errorMessage system
//   * Useful for clearing corrupted or stale autosave data
// - IMPROVED: Round 1 seeding with 4 distinct modes
//   * RANDOM: True random sequential pairing (1vs2, 3vs4, 5vs6 after shuffle)
//   * CROSS ELO: Top half vs bottom half pairing (1vs9, 2vs10, etc. for convergence)
//   * ELO: Elo-sorted cost-based pairing for balanced Round 1 matchups
//   * MANUAL SELECTION: Exact sequential pairing in user-entered order
//   * Random, Cross Elo, and Manual use direct pairing (bypass cost algorithm)
//   * Elo uses cost-based pairing (preserves balanced matchup behavior)
//   * Rounds ≥2 always use normal Swiss cost-based pairing regardless of Round 1 method
//   * Bye assignment remains deterministic using existing rules for all modes
// - FIXED: Manual Pairing warnings now use React modal instead of browser confirm()
//   * Replaced native confirm() with custom warning modal
//   * Shows warning list with Cancel/Proceed Anyway buttons
//   * Works in sandboxed environments where browser modals are blocked
//   * Matches design pattern of delete confirmation modal
// - FIXED: Delete player opps cleanup now immutable
//   * Changed from forEach mutation to .map() immutable pattern
//   * No longer mutates player objects in place
//   * Follows React best practices for state updates
// - IMPROVED: Autosave guard prevents overwriting valid snapshots
//   * Guards against saving empty state during startup
//   * Checks if tournament/players/config all empty before autosave
//   * Prevents race condition where restore happens after empty save
// - IMPROVED: Restore view logic based on tournament state
//   * If tournament active (currentRound > 0) → tournament view
//   * If tournament configured but not started → players view
//   * More intelligent than always defaulting to tournament view
//
// CRASH PROTECTION (v1.90):
// - Added automatic localStorage-based autosave and recovery
//   * Autosave triggers on state changes with 400ms debounce
//   * Saves: players, tournament, allRounds, currentRound, pendingPlayers, config, tournamentConfig
//   * Auto-restore on app load if autosave exists
//   * Validates restored data with safe fallbacks
//   * Protects against browser refresh, crash, or tab reload
//   * Autosave cleared when creating new tournament or aborting
//   * Tournament resumes exactly where it left off after any interruption
//
// CLEANUP (v1.90):
// - Removed redundant Manual Round Seed feature for active tournament rounds
//   * Manual Pairing Editor is now the single tool for emergency pairing adjustments
//   * Removed: showManualRoundSeed, manualRoundSeedNum, manualRoundSeeding state
//   * Removed: applyManualRoundSeed function (88 lines)
//   * Removed: Manual Seed button and modal from active rounds
//   * Kept: Round 1 seeding before tournament start
//   * Kept: CSV import and Manual Selection seeding
// - Removed unused lucide-react icon imports
//   * Removed: Users, Trophy, Plus, Award, Settings (5 unused icons)
//   * Kept: All actively used icons
// - Code reduction: ~200 lines removed, cleaner UI with less redundant controls
//
// FIXES (v1.90 - Updated):
// 0. FIXED: Delete player confirmation modal (sandbox compatibility) + deletion bugs
//    - Replaced native browser confirm() with React confirmation modal
//    - Works in sandboxed environments where browser modals are blocked
//    - Architecture: deletePlayerFromTournament() opens modal, performDeletePlayer() executes deletion
//    - Modal shows player name and warning about match removal
//    - Cancel/Delete buttons with red destructive styling
//    - BUG FIX: Current round now regenerated after deletion if affected
//      * Calculates standings before current round
//      * Sorts with compareRankings
//      * Calls createPairings to rebuild round with proper bye assignment
//      * Handles odd player count correctly (creates bye when needed)
//    - BUG FIX: Deleted players no longer reappear in rankings
//      * Removed manual recalc() call that used stale tournament state
//      * useEffect hook triggers recalc() with updated state after deletion
//      * Prevents async state timing issues
//
// 1. FIXED: Opponent history cleanup when deleting players
//    - deletePlayerFromTournament() now removes deleted player ID from all remaining players' opps arrays
//    - Prevents ghost opponent references that could cause incorrect pairing behavior
//    - Ensures clean opponent history after player deletion
//
// 2. FIXED: Standardized table number property to 'tbl'
//    - Replaced inconsistent usage of both 'table' and 'tbl' properties
//    - All match objects now use consistent 'tbl' property
//    - Manual pairing editor now generates matches with 'tbl: idx + 1'
//
// 3. IMPROVED: Cost-based greedy pairing algorithm (STEP 3)
//    - Replaced "first legal opponent" with cost-based candidate evaluation
//    - Cost formula: mpGap × 10000 + scoreGroupBreakPenalty + rankGap × 100 + ratingGap + repeatPenalty
//    - Evaluates all available opponents and selects lowest-cost pairing
//    - Improves fairness: keeps players with same MP together, minimizes rating gaps
//    - Preserves bye assignment and new-player pairing logic unchanged
//
// 4. FIXED: Duplicate prevention in opponent histories (opps arrays)
//    - All opps array updates now check for existing IDs before adding
//    - Pattern: opps.includes(id) ? opps : [...opps, id]
//    - Prevents duplicate opponent IDs like [5, 5] in opps arrays
//    - Applied to both recalc() and manual round calculation functions
//
// PREVIOUS FIXES (v1.90 - Original):
// 1. ADDED: Full player deletion with UI buttons
//    - Delete button in standings (next to each player name)
//    - Delete button for removed players (permanent deletion)
//    - Removes player from tournament.players
//    - Removes all matches involving that player from all rounds
//    - Recalculates standings using existing recalc() logic
//    - Confirmation dialog before deletion
//    - Works both before and during tournament
//
// 2. FIXED: Deterministic bye assignment based on active ranking system
//    - Bye always goes to lowest-ranked eligible player
//    - Eligibility: no previous bye AND not joined this round
//    - Uses active ranking system (Classic or Rack Diff) to determine "lowest"
//    - Bye assignment happens FIRST before any pairing
//    - Manual seed changes cannot override bye rules
//    - Algorithm: Sort → Find lowest eligible → Assign bye → Pair remaining
//
// 3. ADDED: Manual Pairing Editor (TD emergency tool)
//    - New purple "Manual Pairings" button next to "Manual Seed"
//    - Shows actual pairings (Table 1: A vs B, Table 2: C vs D, Bye: X)
//    - Allows direct player swaps between matches using dropdowns
//    - Can change bye recipient (if eligible)
//    - Validates and warns about: repeated pairings, illegal bye assignments
//    - Allows TD override of warnings
//    - Applies changes immediately and recalculates
//
// 4. FIXED: Next-round seeding respects selected ranking system
//    - All pairing generation now uses compareRankings function
//    - Classic mode: MP → Performance
//    - Rack Differential mode: MP → Rack Diff → Performance
//    - Fixed in: nextRound(), regenerateRound(), manual seed initialization
//    - Pairings always match the ranking order shown in standings
//
// PREVIOUS FIX (v1.89):
// UX IMPROVEMENT: Club Database Dropdown Filters Out Already-Registered Players
// - Players tab dropdown: Hides players already in the players list
// - Add Player modal dropdown: Hides players already in tournament or global players list
// - Shows helpful message when all database players are already registered
// - Prevents accidental duplicate selections
// - Cleaner UI - only shows available players
// PREVIOUS FIX (v1.89):
// - Export Buttons Now Regenerate on Every View
// - Problem: Exports generated once and cached forever, never updated when tournament changed
//   * User exports → modifies tournament → exports again → gets OLD data ❌
//   * User starts new tournament → exports → gets data from PREVIOUS tournament ❌
// - Root cause: useEffect had check "if URLs exist, don't regenerate"
// - Solution: Remove "generate once" check, always regenerate when viewing Final Results
//   * Clean up old blob URLs before creating new ones (prevent memory leaks)
//   * Remove export URLs from useEffect dependencies (prevent infinite loops)
// - Result: Fresh exports every time, always shows current tournament data ✅
// PREVIOUS FIX (v1.89):
// - Image Export Column Spacing (Spacious Tier)
// - Problem: For 6-12 players, ELO and Performance columns too close together
// - Solution: Adjusted column widths in spacious tier:
//   * Name: 40% → 37% (slightly narrower, still fits BC Joe's longest names)
//   * ELO: 15% → 17% (+2% more space)
//   * Perf: 8% → 9% (+1% more space)
// - Result: Better visual separation between ELO and Performance columns ✅
// PREVIOUS FIX (v1.89):
// - ELO Database Export Now Includes Manually Added Players
// - Problem: If club database loaded, manually added players weren't included in export
// - Old logic: Only exported players from original club database (updated ELOs for participants)
// - New logic: Exports ALL players (original database + any manually added players)
// - Result: Manually added players now appear in exported ELO database ✅
// PREVIOUS FIXES (v1.89):
// 1. FIXED: Low-ELO new players getting Freilos (bye)
//    - Problem: Greedy pairing algorithm paired from top-down, so low-ELO new players
//      processed last and could end up unpaired → got bye despite restriction
//    - Solution: Two-phase pairing - pair ALL new players first (regardless of ELO),
//      then apply greedy algorithm to remaining players
//    - Result: New players NEVER get byes, even with lowest ELO
// 2. FIXED: Export buttons crashing on Chrome browser
//    - Problem: Hybrid button/anchor pattern with onClick handlers not compatible across browsers
//    - Solution: Reverted to v1.82 working pattern (simple anchor tags with blob URLs)
//    - BUT kept lazy generation (useEffect only when view === 'results', generate once)
//    - Result: Exports work reliably on Chrome, Brave, Firefox, Safari
// PREVIOUS FIXES (v1.84):
// - Replaced exponential backtracking pairing algorithm with O(N^2) greedy algorithm
// - OLD ALGORITHM (v1.83 and earlier):
//   * tryAllPairings() - recursive backtracking with exponential time complexity
//   * Time: O(6^(N/2)) worst case - with 20 players = up to 60 MILLION operations!
//   * Round 1 with 20 players: ~50ms (no constraints)
//   * Round 2 with 20 players: ~2000ms (opponent history constraints)
//   * Round 3 with 20 players: ~15000ms (browser unresponsive warning)
//   * Round 4 with 20 players: TIMEOUT/CRASH (exponential explosion)
// - NEW ALGORITHM (v1.84):
//   * Greedy pairing: pair each player with highest-ranked opponent they haven't faced
//   * Time: O(N^2) - with 20 players = ~400 operations maximum
//   * ALL rounds with 20 players: <10ms consistently
//   * Works perfectly with 2-30+ players, any round
// - Result: Starting tournament and advancing rounds is now INSTANT regardless of player count
// PREVIOUS FIX (v1.83):
// - Lazy export generation: CSV and image exports now generate ONLY when user clicks export button
// - Previous version: Generated all exports automatically on EVERY tournament state change
// - Problem: With 20+ players, auto-generation caused:
//   * 500ms-1000ms blocking canvas operations per generation
//   * Multiple regenerations during tournament start (3-5x)
//   * Memory spikes and crashes with large player counts
// - Solution: On-demand generation eliminates unnecessary processing
// - Result: Tournament starts instantly regardless of player count (tested 2-30 players)
// - Export buttons now trigger download immediately (no pre-generated blob URLs)
// MAJOR UPDATE: TIER-BASED IMAGE EXPORT SYSTEM
// - Image export now uses 4-tier adaptive scaling system based on player count
// - Tier 1 (Spacious, 6-12 players): Shows ALL columns, large fonts, generous spacing
//   * Name column: 40% width (optimized for long names like "Feras Abou Al Fadel")
// - Tier 2 (Balanced, 13-18 players): Shows ALL columns, medium fonts, moderate spacing
//   * Name column: 38% width (handles names up to ~20 characters)
// - Tier 3 (Compact, 19-24 players): Essential only (Rank, Name, RP, MP, Rack) - NO ELO/Perf
// - Tier 4 (Dense, 25-30 players): Critical only (Rank, Name, RP, MP) - NO Rack
// - Each tier optimized for readability on 4:5 format (1080x1350px)
// - Fonts, row heights, and column widths dynamically adjust per tier
// - Always readable on phone screens regardless of player count (6-30)
// - BC Joe's player names display in full without truncation (tested with 43-player database)
// ENHANCED CSV EXPORT (REORGANIZED):
// - Column order optimized for logical data flow:
//   1. Identity: Rank, Name
//   2. Round Results: R1, R2, R3, R4... (raw data - easy to scan horizontally)
//   3. Totals: Match Points, Total RP (aggregated from rounds)
//   4. Details: Games, Racks Won, Racks Lost, Rack Diff
//   5. Performance: Avg Performance
//   6. ELO Progression: Start ELO, Final ELO, ELO Change
// - Added tournament metadata header (Name, Date, Rounds, Players, Ranking System, RP status)
// - RP metadata label changed from "Round Points:" to "RP:" for consistency
// - Includes current date for archiving purposes (YYYY-MM-DD format)
// - Round-by-round results show points earned (1, 0.5, 0, or -)
// - Allows historical analysis: rounds played per player, performance trends, participation tracking
// - Optimized for Google Sheets import with proper formatting
// PREVIOUS FEATURES (v1.81):
// - Tournament title can be edited after starting tournament
// - Table Numbers button in Round view toolbar
// - Final Results: All number columns use same font size (text-2xl)
// - Final Results: Shadow placeholders removed for proper alignment
// - Final Results: Round-by-round results as separate columns
// - Final Results: RP displayed as "20 RP", Rack Diff formatted (+8, 0, -3)
// - Version number v1.89 displayed in UI header
// FEATURES:
// - Dual ranking system - Classic (MP + Perf/10000) vs Rack Differential (MP → Rack Diff → Perf)
// - CSV exports - Final Results with metadata and Updated ELO Database
// - Updated Database export: Merges tournament results back into club database
// - CSV Import: Strips quotes from names when importing
// - Rack Differential = Racks Won - Racks Lost (excludes bye matches)

import React, { useState, useEffect } from 'react';
import { Play, Edit, Trash2, UserPlus, UserMinus, Table, RotateCw, User, Target, XCircle, Download } from 'lucide-react';
import {
  applyFixedRackMatch,
  classicStandingScore,
  compareFixedRackPairingOrder,
  compareFixedRackStandings,
  expectedScore,
  fixedRackMatchOutcome,
  gbrChange,
  pairingCost,
  performanceGbr,
  selectEligibleBye
} from './domain/fixedRackBbs.js';
import {
  STRAIGHT_POOL_DEFAULTS,
  calcNPD,
  calcStraightPoolSignals,
  normalizeWeights,
  assignStraightPoolTierTargets as assignStraightPoolTierTargetsPure,
  calcStraightPoolGbrChange as calcStraightPoolGbrChangePure,
  calcStraightPoolPerf as calcStraightPoolPerfPure,
  compareStraightPool as compareStraightPoolPure,
  getSP as getStraightPoolConfig,
  getStraightPoolTargetForMatch as getStraightPoolTargetForMatchPure,
  isStraightPool as isStraightPoolFormat
} from './domain/straightPool14_1.js';

const PoolTournamentApp = () => {
  // Configuration and state
  const [config, setConfig] = useState({ 
    d: 330, 
    k_m: 30, 
    k_r: 20, 
    max_games: 6, 
    default_rounds: 4,
    use_rp: true,
    rp_per_round: 10,
    rp_per_mp: 10,
    rp_elo_multiplier: 0.15,
    ranking_system: 'classic', // 'classic' (MP -> Perf -> ID) or 'racks' (MP -> Racks -> Perf -> ID)
    use_rank: false, // Optional placement-based tournament series score
    // v1.92: tournament format. 'fixed_rack' = existing stable behavior (default).
    format: 'fixed_rack', // 'fixed_rack' | 'straight_pool_14_1'
    // v1.92: GBR_14.1 Experimental (straight pool) settings. Only used when
    // format === 'straight_pool_14_1'. Safe defaults preserved for old snapshots.
    straightPool: {
      enabled: false,
      label: 'GBR_14.1 Experimental',
      startTarget: 40,
      tieringStartsRound: 2,
      tierTargets: [50, 40, 30],
      targetReference: 40,
      useTargetScaledK: true,
      k_14_1: 20,
      marginWeight: 0.60,
      bpiWeight: 0.30,
      highRunWeight: 0.10,
      standingsOrder: 'mp_perf_npd'
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState('tournament');
  const [tournamentConfig, setTournamentConfig] = useState(null); // Stores tournament setup before starting
  const [players, setPlayers] = useState([]);
  const [tournament, setTournament] = useState(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [viewingRound, setViewingRound] = useState(1);
  const [allRounds, setAllRounds] = useState({});
  const [newPlayer, setNewPlayer] = useState({ name: '', elo: 1500 });
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRemovePlayerModal, setShowRemovePlayerModal] = useState(false);
  const [playersToRemove, setPlayersToRemove] = useState([]);
  const [seedMethod, setSeedMethod] = useState('random');
  const [tableNumbers, setTableNumbers] = useState([]);
  const [showTableConfig, setShowTableConfig] = useState(false);
  const [manualSeeding, setManualSeeding] = useState([]);
  const [clubDatabase, setClubDatabase] = useState([]);
  const [exportResultsURL, setExportResultsURL] = useState(null);
  const [exportELOsURL, setExportELOsURL] = useState(null);
  const [showClubDatabaseModal, setShowClubDatabaseModal] = useState(false);
  const [tempClubData, setTempClubData] = useState([]);
  const [showSeedingModal, setShowSeedingModal] = useState(false);
  const [showClearAutosaveConfirm, setShowClearAutosaveConfirm] = useState(false);
  const [preAdvanceSnapshot, setPreAdvanceSnapshot] = useState(null);
  const [showUndoAdvanceConfirm, setShowUndoAdvanceConfirm] = useState(false);
  const [tournamentTitle, setTournamentTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [configPresets, setConfigPresets] = useState([
    { name: "BC Joe's VM", d: 330, k_m: 30, k_r: 20, max_games: 6, default_rounds: 4, use_rp: true, rp_per_round: 10, rp_per_mp: 10, rp_elo_multiplier: 0.15, ranking_system: 'classic', use_rank: false },
    { name: 'New Baseline', d: 330, k_m: 30, k_r: 20, max_games: 6, default_rounds: 5, use_rp: false, rp_per_round: 10, rp_per_mp: 10, rp_elo_multiplier: 0.15, ranking_system: 'classic', use_rank: false },
    { name: 'Old System', d: 330, k_m: 20, k_r: 25, max_games: 6, default_rounds: 5, use_rp: false, rp_per_round: 10, rp_per_mp: 10, rp_elo_multiplier: 0.15, ranking_system: 'classic', use_rank: false },
    { name: '14.1 Club Championship Experimental', d: 330, k_m: 30, k_r: 20, max_games: 6, default_rounds: 5, use_rp: true, rp_per_round: 10, rp_per_mp: 10, rp_elo_multiplier: 0.15, ranking_system: 'classic', use_rank: false, format: 'straight_pool_14_1', straightPool: { enabled: true, label: 'GBR_14.1 Experimental', startTarget: 40, tieringStartsRound: 2, tierTargets: [50, 40, 30], targetReference: 40, useTargetScaledK: true, k_14_1: 20, marginWeight: 0.60, bpiWeight: 0.30, highRunWeight: 0.10, standingsOrder: 'mp_perf_npd' } }
  ]);
  const [showConfigPresets, setShowConfigPresets] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [showSeedingImport, setShowSeedingImport] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [regenerateRoundNum, setRegenerateRoundNum] = useState(null);
  const [pendingPlayers, setPendingPlayers] = useState([]); // Players added mid-round, waiting for next round
  
  // Manual Pairing Editor (Fix #3)
  const [showManualPairings, setShowManualPairings] = useState(false);
  const [manualPairingsRound, setManualPairingsRound] = useState(null);
  const [manualPairingsData, setManualPairingsData] = useState([]);
  const [showManualPairingWarnings, setShowManualPairingWarnings] = useState(false);
  const [manualPairingWarnings, setManualPairingWarnings] = useState([]);
  
  // Delete Player Confirmation Modal
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [playerToDelete, setPlayerToDelete] = useState(null);

  // No-legal-bye error modal (whitepaper §9.2: repeated byes are illegal).
  // Shown when an odd field has no eligible bye player available.
  const [showByeError, setShowByeError] = useState(false);

  // Load default players

  // Calculate ELO change (zero-sum with match and rack k-factors)
  const calcEloChange = (elo1, elo2, r1, r2) => gbrChange(elo1, elo2, r1, r2, config);

  // Calculate performance GBR (PERF). Whitepaper §4.3: perfect/zero rack scores
  // are capped at ±3d (with default d=330 this gives ±990, ~99.9% / 0.1% implied).
  const calcPerformanceElo = (opponentElo, myRacks, oppRacks) =>
    performanceGbr(opponentElo, myRacks, oppRacks, config.d);

  // ===================================================================
  // v1.92: GBR_14.1 EXPERIMENTAL (straight pool) helpers
  // EXPERIMENTAL: this is a 14.1-specific signal/rating model, not calibrated.
  // Fixed-rack GBR behavior is unchanged and used whenever format !== 14.1.
  // Pure math/config resolution now lives in src/domain/straightPool14_1.js (M2B).
  // These are thin closures that resolve the component's config into the
  // pure functions' explicit arguments, preserving every existing call site.
  // ===================================================================
  const getSP = () => getStraightPoolConfig(config.straightPool);
  const isStraightPool = () => isStraightPoolFormat(config.format);
  const calcStraightPoolPerf = (opponentGbr, s141) => calcStraightPoolPerfPure(opponentGbr, s141, config.d);
  const calcStraightPoolGbrChange = (gbr1, gbr2, matchData) =>
    calcStraightPoolGbrChangePure(gbr1, gbr2, matchData, { d: config.d, k_m: config.k_m, sp: getSP() });
  const assignStraightPoolTierTargets = (sortedPlayers, roundNum) =>
    assignStraightPoolTierTargetsPure(sortedPlayers, roundNum, getSP());
  const getStraightPoolTargetForMatch = (p1, p2, tierMap) =>
    getStraightPoolTargetForMatchPure(p1, p2, tierMap, getSP());
  const compareStraightPool = (a, b) => compareStraightPoolPure(a, b, config.ranking_system);

  // Open delete player confirmation modal
  const deletePlayerFromTournament = (playerId) => {
    if (!tournament) return;
    
    const player = tournament.players.find(p => p.id === playerId);
    if (!player) return;
    
    setPlayerToDelete(player);
    setShowDeleteConfirm(true);
  };

  // Execute player deletion (called after confirmation)
  // Reconstruct each player's standings as of BEFORE `roundLimit` — i.e. through all
  // completed matches in rounds strictly < roundLimit — mirroring recalc()'s logic
  // for BOTH fixed-rack and GBR_14.1 modes. Returns a map keyed by player id.
  // Used by every current-round regeneration path so the list handed to
  // createPairings() is complete and correctly ordered (so the bye lands right).
  const buildStandingsBeforeRound = (roundLimit, basePlayers, roundsData) => {
    const standings = {};
    basePlayers
      .filter(p => !p.removed && (p.joinedRound || 1) <= roundLimit)
      .forEach(p => {
        const startElo = players.find(pl => pl.id === p.id)?.elo || p.elo;
        standings[p.id] = {
          ...p,
          mp: 0, perf: 0, perfCount: 0, elo: startElo, games: 0,
          racksWon: 0, racksLost: 0, opps: [],
          pointsFor: 0, pointsAgainst: 0, inningsTotal: 0, npd: 0, hs: 0, hgd: 0
        };
      });

    for (let r = 1; r < roundLimit; r++) {
      (roundsData[r] || []).forEach(m => {
        if (!m.done || m.cancelled) return;
        const p1Data = standings[m.p1.id];
        const p2Data = standings[m.p2.id];

        // ---- GBR_14.1 experimental match ----
        if (m.format === 'straight_pool_14_1' && !m.bye) {
          const PA = Number(m.p1Points) || 0, PB = Number(m.p2Points) || 0;
          const inn = Number(m.innings) || 0;
          const HRA = Number(m.p1HighRun) || 0, HRB = Number(m.p2HighRun) || 0;
          const tgt = m.target || getSP().startTarget;
          const g1 = p1Data ? p1Data.elo : m.p1.elo;
          const g2 = p2Data ? p2Data.elo : m.p2.elo;
          const sigA = calcStraightPoolSignals(PA, PB, inn, HRA, HRB, tgt, getSP());
          const sigB = calcStraightPoolSignals(PB, PA, inn, HRB, HRA, tgt, getSP());
          const ch = calcStraightPoolGbrChange(g1, g2, { p1Points: PA, p2Points: PB, innings: inn, p1HighRun: HRA, p2HighRun: HRB, target: tgt });
          if (p1Data) {
            p1Data.mp += PA > PB ? 1 : PA === PB ? 0.5 : 0;
            p1Data.games++; p1Data.elo += ch;
            p1Data.perf += calcStraightPoolPerf(g2, sigA.s141); p1Data.perfCount++;
            p1Data.pointsFor += PA; p1Data.pointsAgainst += PB; p1Data.inningsTotal += inn;
            p1Data.npd += calcNPD(PA, PB, tgt); p1Data.hs = Math.max(p1Data.hs, HRA);
            p1Data.hgd = Math.max(p1Data.hgd, inn > 0 ? PA / inn : 0);
            if (p2Data && !p1Data.opps.includes(m.p2.id)) p1Data.opps.push(m.p2.id);
          }
          if (p2Data) {
            p2Data.mp += PB > PA ? 1 : PB === PA ? 0.5 : 0;
            p2Data.games++; p2Data.elo -= ch;
            p2Data.perf += calcStraightPoolPerf(g1, sigB.s141); p2Data.perfCount++;
            p2Data.pointsFor += PB; p2Data.pointsAgainst += PA; p2Data.inningsTotal += inn;
            p2Data.npd += calcNPD(PB, PA, tgt); p2Data.hs = Math.max(p2Data.hs, HRB);
            p2Data.hgd = Math.max(p2Data.hgd, inn > 0 ? PB / inn : 0);
            if (p1Data && !p2Data.opps.includes(m.p1.id)) p2Data.opps.push(m.p1.id);
          }
          return;
        }

        // ---- Bye ----
        if (m.bye) {
          if (p1Data) { p1Data.mp += 1; p1Data.games++; } // bye = +1 MP, no other stats
          return;
        }

        // ---- Fixed-rack match: canonical domain formula (src/domain/fixedRackBbs.js),
        // applied here rather than via applyFixedRackMatch()'s array lookup, since a
        // removed/not-yet-active player may be absent from `standings` while their
        // opponent still needs that player's match-stored GBR as the pre-match snapshot.
        const g1 = p1Data ? p1Data.elo : m.p1.elo;
        const g2 = p2Data ? p2Data.elo : m.p2.elo;
        const outcome = fixedRackMatchOutcome(m.r1, m.r2, g1, g2, config);
        if (p1Data) {
          p1Data.mp += outcome.mpA;
          p1Data.games++; p1Data.elo += outcome.change;
          p1Data.perf += outcome.perfA; p1Data.perfCount++;
          p1Data.racksWon += m.r1; p1Data.racksLost += m.r2;
          if (p2Data && !p1Data.opps.includes(m.p2.id)) p1Data.opps.push(m.p2.id);
        }
        if (p2Data) {
          p2Data.mp += outcome.mpB;
          p2Data.games++; p2Data.elo -= outcome.change;
          p2Data.perf += outcome.perfB; p2Data.perfCount++;
          p2Data.racksWon += m.r2; p2Data.racksLost += m.r1;
          if (p1Data && !p2Data.opps.includes(m.p1.id)) p2Data.opps.push(m.p1.id);
        }
      });
    }
    return standings;
  };

  // Build the complete, format-aware, sorted pairing list as of before `roundLimit`.
  const buildSortedStandingsBeforeRound = (roundLimit, basePlayers, roundsData) => {
    const standings = buildStandingsBeforeRound(roundLimit, basePlayers, roundsData);
    return Object.values(standings)
      .map(p => ({ ...p, avgPerf: p.perfCount > 0 ? p.perf / p.perfCount : 0 }))
      .sort(comparePairingOrder); // format-aware (14.1 uses compareStraightPool)
  };

  const performDeletePlayer = () => {
    if (!tournament || !playerToDelete) return;
    
    const playerId = playerToDelete.id;
    
    // Remove player from tournament players list
    const filteredPlayers = tournament.players.filter(p => p.id !== playerId);
    
    // FIX 1: Remove deleted player ID from all remaining players' opps arrays (immutable)
    const updatedTournamentPlayers = filteredPlayers.map(player => ({
      ...player,
      opps: player.opps ? player.opps.filter(oppId => oppId !== playerId) : []
    }));
    
    // Remove player from all rounds' matches
    const updatedRounds = {};
    let needsRoundRegeneration = false;
    
    Object.keys(allRounds).forEach(roundNum => {
      const roundMatches = allRounds[roundNum] || [];
      
      // Filter out matches where this player was involved
      const filteredMatches = roundMatches.filter(match => 
        match.p1.id !== playerId && match.p2.id !== playerId
      );
      
      updatedRounds[roundNum] = filteredMatches;
      
      // Check if current round was affected
      if (parseInt(roundNum) === currentRound && filteredMatches.length !== roundMatches.length) {
        needsRoundRegeneration = true;
      }
    });
    
    // If current round was affected, regenerate it with proper pairings (including bye if needed)
    if (needsRoundRegeneration && currentRound > 0) {
      // Reconstruct complete, format-aware standings through rounds < currentRound
      const sorted = buildSortedStandingsBeforeRound(currentRound, updatedTournamentPlayers, updatedRounds);

      // Regenerate current round pairings (this will create bye if player count is now odd)
      const newMatches = createPairings(sorted, 0, currentRound);
      if (newMatches === null) { setShowByeError(true); return; } // no legal bye (§9.2)
      updatedRounds[currentRound] = newMatches;
    }
    
    // Update tournament with updated players
    setTournament({
      ...tournament,
      players: updatedTournamentPlayers
    });
    
    // Update all rounds (including regenerated current round if applicable)
    setAllRounds(updatedRounds);
    
    // Close modal and clear state
    setShowDeleteConfirm(false);
    setPlayerToDelete(null);
    
    // Note: recalc() will be triggered by useEffect when allRounds updates
    // No need to call it manually here - this prevents stale state issues
  };

  // Compare two players for ranking based on selected system
  const compareRankings = (playerA, playerB) => {
    // 14.1 standings: Classic = MP->PERF->PointDiff->GD->HS->ID; PointDiff = MP->PointDiff->PERF->GD->HS->ID
    if (isStraightPool()) {
      return compareStraightPool(playerA, playerB);
    }
    if (config.ranking_system === 'racks') {
      return compareFixedRackStandings(playerA, playerB, 'racks');
    }
    return compareFixedRackStandings(playerA, playerB, 'classic');
  };

  // Compare players for pairing order (NOT final standings)
  // Used for creating pairings - same order in both Classic and Rack modes
  // Pairing order: MP -> Performance (rack diff NOT considered)
  const comparePairingOrder = (playerA, playerB) => {
    // v1.93: in 14.1 mode pairing/tiering uses the 14.1 standings comparator
    if (isStraightPool()) {
      return compareStraightPool(playerA, playerB);
    }
    return compareFixedRackPairingOrder(playerA, playerB);
  };

  // Calculate Prestige Score (snapshot calculation from tournament start)
  const calcRP = (gamesPlayed, totalMP, totalEloGain) => {
    if (!config.use_rp) return 0;
    
    const rpForGames = gamesPlayed * config.rp_per_round;
    const rpForMP = totalMP * config.rp_per_mp;
    const rpForElo = totalEloGain > 0 ? totalEloGain * config.rp_elo_multiplier : 0;
    
    return rpForGames + rpForMP + rpForElo;
  };

  // Calculate Prestige Score for a single round/match
  const calcRoundRP = (matchPoints, eloChange) => {
    if (!config.use_rp) return 0;
    
    const rpForRound = config.rp_per_round; // 1 round played
    const rpForMP = matchPoints * config.rp_per_mp; // MP earned in this match (0, 0.5, or 1)
    const rpForElo = eloChange > 0 ? eloChange * config.rp_elo_multiplier : 0; // Only positive ELO gains
    
    return rpForRound + rpForMP + rpForElo;
  };

  // Calculate Event Score (optional final-table reporting metric, whitepaper §7.11).
  // Event Score = round(100 * F * Q), Q = 0.70*MP/R + 0.20*RDnorm + 0.10*PERFnorm.
  // Descriptive only: does NOT affect pairing, standings order, tiebreaking, or GBR.
  // (Internal name calcRank/use_rank retained to avoid wiring bugs.)
  const calcRank = (player, allPlayers, tournament, clubDatabase) => {
    if (!config.use_rank) return 0;
    
    // Get tournament parameters
    const R = tournament.totalRounds;
    const MP = player.mp || 0;
    const RD = (player.racksWon || 0) - (player.racksLost || 0);
    const Perf = player.avgPerf || 0;
    
    // Calculate RD_max (maximum possible absolute rack differential for the event)
    const RD_max = R * config.max_games;
    
    // RDnorm = clamp(RD / RD_max, 0, 1) per whitepaper §7.11.
    // Negative RD -> 0, neutral RD -> 0, positive RD scales up to 1.
    let rdComponent = 0;
    if (RD_max > 0) {
      rdComponent = Math.max(0, Math.min(1, RD / RD_max));
    }
    
    // Calculate average starting ELO of tournament field
    let avgEloField = 0;
    if (allPlayers && allPlayers.length > 0) {
      const totalStartElo = allPlayers.reduce((sum, p) => {
        const startElo = players.find(pl => pl.id === p.id)?.elo || p.elo;
        return sum + startElo;
      }, 0);
      avgEloField = totalStartElo / allPlayers.length;
    }
    
    // Calculate average ELO of club database
    let avgEloClub = 0;
    if (clubDatabase && clubDatabase.length > 0) {
      const totalClubElo = clubDatabase.reduce((sum, p) => sum + (p.elo || 0), 0);
      avgEloClub = totalClubElo / clubDatabase.length;
    }
    
    // Calculate field factor
    let fieldFactor = 1; // Default
    if (avgEloClub > 0 && avgEloField > 0) {
      fieldFactor = avgEloField / avgEloClub;
    }
    
    // PERFnorm: implementation-defined scaled comparison of the player's PERF
    // against the tournament field average (clamped to [0,1]).
    let perfComponent = 0.5; // Default
    if (avgEloField > 0) {
      perfComponent = 0.5 + (Perf - avgEloField) / 800;
      // Clamp to [0, 1]
      perfComponent = Math.max(0, Math.min(1, perfComponent));
    }
    
    // Event Score = round(100 * Q * F), Q = 0.70*MP/R + 0.20*RDnorm + 0.10*PERFnorm
    let mpComponent = 0;
    if (R > 0) {
      mpComponent = MP / R;
    }
    
    const baseScore = 0.70 * mpComponent + 0.20 * rdComponent + 0.10 * perfComponent;
    const rank = Math.round(100 * baseScore * fieldFactor);
    
    return rank;
  };

  // Create tournament configuration (before adding players/starting)
  const createTournamentConfig = (title, settings) => {
    // Clear autosave when starting fresh tournament
    localStorage.removeItem('poolTournamentAutosave');
    
    setTournamentConfig({
      title: title || 'Untitled Tournament',
      ...settings
    });
    setConfig(settings); // Update active config
    setView('players'); // Move to Players tab
  };

  // Start tournament
  const startTournament = () => {
    let sortedPlayers = [...players];
    
    if (seedMethod === 'elo' || seedMethod === 'cross_elo') {
      sortedPlayers.sort((a, b) => b.elo - a.elo);
    } else if (seedMethod === 'random') {
      sortedPlayers.sort(() => Math.random() - 0.5);
    } else if (seedMethod === 'manual') {
      sortedPlayers = manualSeeding.map(id => players.find(p => p.id === id)).filter(Boolean);
    }
    // Any other value: keeps players in current order

    const tournamentPlayers = sortedPlayers.map(p => ({
      ...p,
      mp: 0,
      perf: 0,
      games: 0,
      opps: [],
      removed: false,
      joinedRound: 1  // Track which round the player joined
    }));

    setTournament({
      players: tournamentPlayers,
      totalRounds: config.default_rounds
    });

    const matches = createPairings(tournamentPlayers, 0, 1, seedMethod);
    if (matches === null) { setShowByeError(true); return; } // no legal bye (§9.2)
    setAllRounds({ 1: matches });
    setCurrentRound(1);
    setViewingRound(1);
    setView('round');
  };

  // Create pairings - DETERMINISTIC BYE ASSIGNMENT + SEEDING-AWARE ROUND 1
  // Round 1: Random/Cross Elo/Manual use direct pairing; Elo/Registration use cost-based
  // Rounds ≥2: Always use Swiss pairing (new players by ELO, then cost-based greedy)
  const createPairings = (sortedPlayers, startTableIndex = 0, roundNum = 1, seedMethod = null) => {
    const matches = [];
    let players = [...sortedPlayers];
    
    // Build bye history (who has had a bye in a round STRICTLY BEFORE roundNum).
    // Fix #2: ignore the current round (and any later rounds) so regenerating the
    // current round does not count its own old bye as previous bye history.
    const byeHistory = new Set();
    players.forEach(p => {
      Object.entries(allRounds).forEach(([roundKey, roundMatches]) => {
        if (Number(roundKey) >= roundNum) return;
        (roundMatches || []).forEach(m => {
          if (m.bye && m.p1.id === p.id) byeHistory.add(p.id);
        });
      });
    });

    // Identify newly-added players to protect from an immediate bye.
    // Fix #1: ONLY players who joined AFTER tournament start (joinedRound > 1) in
    // this same round are "new". Initial players (joinedRound === 1) are bye-eligible
    // in Round 1, so odd-player tournaments can start.
    const newPlayerIds = new Set(
      players
        .filter(p => (p.joinedRound || 1) > 1 && p.joinedRound === roundNum)
        .map(p => p.id)
    );

    const paired = new Set();
    
    // STEP 1: DETERMINISTIC BYE ASSIGNMENT (if odd player count)
    // Bye MUST go to lowest-ranked eligible player based on active ranking system
    if (players.length % 2 === 1) {
      const candidate = selectEligibleBye(players, byeHistory, newPlayerIds);
      if (candidate) {
        paired.add(candidate.id);
        matches.push({
          p1: candidate,
          p2: { id: 'bye', name: 'FREILOS', elo: 1300 },
          bye: true
        });
        console.log(`Bye assigned to lowest-ranked eligible: ${candidate.name}`);
      }
      
      // Whitepaper §9.2: repeated byes are illegal. If NO eligible player exists
      // (all active players have already had a bye, or all remaining are new and
      // protected), DO NOT assign a repeat bye. Signal failure to the caller so a
      // visible error is shown and the director can resolve it manually.
      if (!candidate) {
        console.error('No legal bye available: every active player has already received a bye.');
        return null;
      }
    }
    
    // ROUND 1 SPECIAL SEEDING
    // Random, Cross Elo, and Manual Selection use direct pairing
    // Elo uses cost-based pairing for balanced matchups
    if (roundNum === 1 && (seedMethod === 'random' || seedMethod === 'cross_elo' || seedMethod === 'manual')) {
      const unpaired = players.filter(p => !paired.has(p.id));
      
      if (seedMethod === 'random' || seedMethod === 'manual') {
        // SEQUENTIAL PAIRING: pair in order (1vs2, 3vs4, 5vs6, ...)
        // Random: players already shuffled in startTournament
        // Manual: players already in manual order from startTournament
        for (let i = 0; i < unpaired.length - 1; i += 2) {
          matches.push({
            p1: unpaired[i],
            p2: unpaired[i + 1],
            bye: false
          });
          paired.add(unpaired[i].id);
          paired.add(unpaired[i + 1].id);
        }
      } else if (seedMethod === 'cross_elo') {
        // CROSS-ELO PAIRING: top half vs bottom half
        // Players already sorted by ELO descending in startTournament
        const halfPoint = Math.floor(unpaired.length / 2);
        const topHalf = unpaired.slice(0, halfPoint);
        const bottomHalf = unpaired.slice(halfPoint);
        
        for (let i = 0; i < topHalf.length; i++) {
          matches.push({
            p1: topHalf[i],
            p2: bottomHalf[i],
            bye: false
          });
          paired.add(topHalf[i].id);
          paired.add(bottomHalf[i].id);
        }
      }
      
      // Skip STEP 2 and STEP 3 for these Round 1 seeding methods
    } else {
      // NORMAL SWISS PAIRING (for Rounds ≥2, or Round 1 with 'elo' seeding)
      // Uses cost-based algorithm for balanced Elo matchups
      
      // STEP 2: Pair new players by closest ELO match
      players.forEach(p1 => {
        if (paired.has(p1.id)) return;
        if (!newPlayerIds.has(p1.id)) return;
        
        let bestOpponent = null;
        let smallestDiff = Infinity;
        
        for (let j = 0; j < players.length; j++) {
          const p2 = players[j];
          if (paired.has(p2.id)) continue;
          if (p2.id === p1.id) continue;
          if ((p1.opps || []).includes(p2.id)) continue;
          
          const p1Rating = p1.avgPerf || p1.elo;
          const p2Rating = p2.avgPerf || p2.elo;
          const diff = Math.abs(p1Rating - p2Rating);
          
          if (diff < smallestDiff) {
            smallestDiff = diff;
            bestOpponent = p2;
          }
        }
        
        if (bestOpponent) {
          paired.add(p1.id);
          paired.add(bestOpponent.id);
          matches.push({ p1, p2: bestOpponent, bye: false });
        }
      });
      
      // STEP 3: Cost-based greedy pairing for remaining players
      for (let i = 0; i < players.length; i++) {
        if (paired.has(players[i].id)) continue;
        
        const p1 = players[i];
        let bestOpponent = null;
        let lowestCost = Infinity;
        
        // Evaluate all available opponents and choose the one with lowest cost
        for (let j = i + 1; j < players.length; j++) {
          if (paired.has(players[j].id)) continue;
          
          const p2 = players[j];
          
          // Calculate cost for this pairing
          // Standard pairing cost (whitepaper §8.9):
          //   C = Prep + 10000*ΔMP + ΔPERF
          // Prep = 100000 if already played, else 0. Rack Differential is NOT used
          // in standard pairing (it remains only a final-standings tiebreaker).
          const cost = pairingCost(p1, p2);
          
          if (cost < lowestCost) {
            lowestCost = cost;
            bestOpponent = p2;
          }
        }
        
        if (bestOpponent) {
          paired.add(p1.id);
          paired.add(bestOpponent.id);
          matches.push({ p1, p2: bestOpponent, bye: false });
        } else {
          // Last resort: pair with anyone remaining (even if repeat)
          let fallbackOpponent = null;
          for (let j = i + 1; j < players.length; j++) {
            if (paired.has(players[j].id)) continue;
            
            fallbackOpponent = players[j];
            break;
          }
          
          if (fallbackOpponent) {
            paired.add(p1.id);
            paired.add(fallbackOpponent.id);
            matches.push({ p1, p2: fallbackOpponent, bye: false, repeat: true });
            console.warn(`Repeat pairing: ${p1.name} vs ${fallbackOpponent.name}`);
          } else {
            console.error(`ERROR: Player left unpaired: ${p1.name}`);
          }
        }
      }
    }
    
    // v1.92: in 14.1 mode, compute tier targets for this round (based on the
    // standings order the players were sorted into) and stamp each match.
    const sp = getSP();
    const tierMap = isStraightPool()
      ? assignStraightPoolTierTargets(sortedPlayers, roundNum)
      : null;

    return matches.map((pair, idx) => {
      const base = {
        id: Date.now() + idx,
        p1: pair.p1,
        p2: pair.p2,
        // Whitepaper §9.3: a bye awards 1 MP but contributes no racks. Store it as
        // r1=0, r2=0, done=true, bye=true so it is never shown/treated as a 6-0 result.
        r1: 0,
        r2: 0,
        done: pair.bye,
        cancelled: false,
        bye: pair.bye,
        tbl: tableNumbers[startTableIndex + idx] || (startTableIndex + idx + 1)
      };
      if (isStraightPool()) {
        base.format = 'straight_pool_14_1';
        base.target = pair.bye ? 0 : getStraightPoolTargetForMatch(pair.p1, pair.p2, tierMap);
        base.p1Points = 0;
        base.p2Points = 0;
        base.innings = 0;
        base.p1HighRun = 0;
        base.p2HighRun = 0;
      } else {
        base.format = 'fixed_rack';
      }
      return base;
    });
  };

  // Complete match
  const completeMatch = (roundNum, matchId) => {
    const match = allRounds[roundNum].find(m => m.id === matchId);

    // ---- v1.92: 14.1 experimental completion + validation ----
    if (match && match.format === 'straight_pool_14_1') {
      const PA = Number(match.p1Points) || 0;
      const PB = Number(match.p2Points) || 0;
      const inn = Number(match.innings) || 0;
      const HRA = Number(match.p1HighRun) || 0;
      const HRB = Number(match.p2HighRun) || 0;
      const target = match.target || getSP().startTarget;

      if (PA === 0 && PB === 0) {
        setErrorMessage('Please enter points for at least one player');
        setTimeout(() => setErrorMessage(''), 3000);
        return;
      }
      if (inn <= 0) {
        setErrorMessage('Innings must be a positive number');
        setTimeout(() => setErrorMessage(''), 3000);
        return;
      }
      if (HRA < 0 || HRB < 0) {
        setErrorMessage('High runs must be non-negative');
        setTimeout(() => setErrorMessage(''), 3000);
        return;
      }
      if ((PA > 0 && HRA > PA) || (PB > 0 && HRB > PB)) {
        setErrorMessage('A high run cannot exceed that player\'s points');
        setTimeout(() => setErrorMessage(''), 4000);
        return;
      }
      // TD override: time-limited 14.1 matches may end with neither reaching target
      if (PA < target && PB < target) {
        console.warn(`14.1: neither player reached target ${target} (TD override allowed for time-limited matches)`);
      }

      setAllRounds({
        ...allRounds,
        [roundNum]: allRounds[roundNum].map(m =>
          m.id === matchId
            ? { ...m, p1Points: PA, p2Points: PB, innings: inn, p1HighRun: HRA, p2HighRun: HRB,
                // keep r1/r2 mirrored for compatibility with any legacy reads
                r1: PA, r2: PB, done: true }
            : m
        )
      });
      recalc();
      return;
    }

    if (!match || (match.r1 === 0 && match.r2 === 0)) {
      setErrorMessage('Please enter at least one score');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }

    // Auto-complete logic: if only one score is entered, calculate the other as max_games - entered_score
    let finalR1 = match.r1;
    let finalR2 = match.r2;
    
    if (match.r1 === 0 && match.r2 > 0) {
      // Only player 2 score entered, calculate player 1 score
      finalR1 = config.max_games - match.r2;
    } else if (match.r2 === 0 && match.r1 > 0) {
      // Only player 1 score entered, calculate player 2 score
      finalR2 = config.max_games - match.r1;
    }

    // Validate: total racks must equal max_games
    if (finalR1 + finalR2 !== config.max_games) {
      setErrorMessage(`Invalid score! Total racks must equal ${config.max_games}. Current: ${finalR1} + ${finalR2} = ${finalR1 + finalR2}`);
      setTimeout(() => setErrorMessage(''), 4000);
      return;
    }

    setAllRounds({
      ...allRounds,
      [roundNum]: allRounds[roundNum].map(m =>
        m.id === matchId ? { ...m, r1: finalR1, r2: finalR2, done: true } : m
      )
    });

    recalc();
  };

  // Recalculate tournament state
  const recalc = () => {
    if (!tournament) return;

    const startElos = {};
    players.forEach(p => startElos[p.id] = p.elo);

    let curr = tournament.players.map(p => ({
      ...p,
      mp: 0,
      perf: 0,
      elo: startElos[p.id] || p.elo,
      games: 0,
      perfCount: 0,
      opps: [],
      rp: 0,
      racksWon: 0,   // Track racks won
      racksLost: 0,  // Track racks lost
      // v1.92: 14.1 experimental aggregates (always present, default 0)
      pointsFor: 0,
      pointsAgainst: 0,
      inningsTotal: 0,
      npd: 0,
      hs: 0,
      hgd: 0
    }));

    for (let round = 1; round <= currentRound; round++) {
      const roundMatches = allRounds[round] || [];
      roundMatches.forEach(match => {
        if (match.done && !match.cancelled) {
          // ---- v1.92: 14.1 experimental match accumulation ----
          if (match.format === 'straight_pool_14_1' && !match.bye) {
            const p1Cur = curr.find(p => p.id === match.p1.id);
            const p2Cur = curr.find(p => p.id === match.p2.id);
            const g1 = p1Cur.elo, g2 = p2Cur.elo;
            const target = match.target || getSP().startTarget;
            const PA = Number(match.p1Points) || 0;
            const PB = Number(match.p2Points) || 0;
            const inn = Number(match.innings) || 0;
            const HRA = Number(match.p1HighRun) || 0;
            const HRB = Number(match.p2HighRun) || 0;

            const spMp1 = PA > PB ? 1 : PA === PB ? 0.5 : 0;
            const spMp2 = PB > PA ? 1 : PB === PA ? 0.5 : 0;

            // Signals from each player's perspective
            const sigA = calcStraightPoolSignals(PA, PB, inn, HRA, HRB, target, getSP());
            const sigB = calcStraightPoolSignals(PB, PA, inn, HRB, HRA, target, getSP());
            const perf1 = calcStraightPoolPerf(g2, sigA.s141);
            const perf2 = calcStraightPoolPerf(g1, sigB.s141);

            const gbrChange = calcStraightPoolGbrChange(g1, g2, {
              p1Points: PA, p2Points: PB, innings: inn,
              p1HighRun: HRA, p2HighRun: HRB, target
            });

            const npd1 = calcNPD(PA, PB, target);
            const npd2 = calcNPD(PB, PA, target);
            const rp1 = calcRoundRP(spMp1, gbrChange);
            const rp2 = calcRoundRP(spMp2, -gbrChange);
            // Per-match GD (this round's balls-per-inning) for HGD (highest round GD)
            const gd1 = inn > 0 ? PA / inn : 0;
            const gd2 = inn > 0 ? PB / inn : 0;

            curr = curr.map(p => {
              if (p.id === match.p1.id) return {
                ...p,
                mp: p.mp + spMp1,
                perf: p.perf + perf1,
                perfCount: p.perfCount + 1,
                elo: p.elo + gbrChange,
                games: p.games + 1,
                opps: p.opps.includes(match.p2.id) ? p.opps : [...p.opps, match.p2.id],
                rp: p.rp + rp1,
                pointsFor: p.pointsFor + PA,
                pointsAgainst: p.pointsAgainst + PB,
                inningsTotal: p.inningsTotal + inn,
                npd: p.npd + npd1,
                hs: Math.max(p.hs, HRA),
                hgd: Math.max(p.hgd, gd1)
              };
              if (p.id === match.p2.id) return {
                ...p,
                mp: p.mp + spMp2,
                perf: p.perf + perf2,
                perfCount: p.perfCount + 1,
                elo: p.elo - gbrChange,
                games: p.games + 1,
                opps: p.opps.includes(match.p1.id) ? p.opps : [...p.opps, match.p1.id],
                rp: p.rp + rp2,
                pointsFor: p.pointsFor + PB,
                pointsAgainst: p.pointsAgainst + PA,
                inningsTotal: p.inningsTotal + inn,
                npd: p.npd + npd2,
                hs: Math.max(p.hs, HRB),
                hgd: Math.max(p.hgd, gd2)
              };
              return p;
            });
            return; // done with this 14.1 match
          }

          curr = applyFixedRackMatch(curr, match, config, calcRoundRP);
        }
      });
    }

    setTournament({
      ...tournament,
      players: curr
    });
  };

  useEffect(() => {
    recalc();
  }, [allRounds, currentRound]);

  // Autosave: Persist tournament state to localStorage (crash protection)
  useEffect(() => {
    // Guard: Don't autosave empty state during startup (would overwrite valid snapshot)
    if (!tournament && players.length === 0 && !tournamentConfig) {
      return; // Skip autosave - app is in initial empty state
    }
    
    const snapshot = {
      players,
      tournament,
      allRounds,
      currentRound,
      pendingPlayers,
      config,
      tournamentConfig,
      preAdvanceSnapshot,
      clubDatabase
    };

    // Debounce autosave to avoid excessive writes
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem('poolTournamentAutosave', JSON.stringify(snapshot));
      } catch (error) {
        console.error('Autosave failed:', error);
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [players, tournament, allRounds, currentRound, pendingPlayers, config, tournamentConfig, preAdvanceSnapshot, clubDatabase]);

  // Auto-restore: Recover tournament state on app load (crash recovery)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('poolTournamentAutosave');
      if (!saved) return;

      const snapshot = JSON.parse(saved);
      
      // Validate snapshot is an object with expected structure
      if (!snapshot || typeof snapshot !== 'object') return;

      // Restore state with safe fallbacks
      if (snapshot.players && Array.isArray(snapshot.players)) {
        setPlayers(snapshot.players);
      }
      if (snapshot.tournament && typeof snapshot.tournament === 'object') {
        setTournament(snapshot.tournament);
      }
      if (snapshot.allRounds && typeof snapshot.allRounds === 'object') {
        setAllRounds(snapshot.allRounds);
      }
      if (typeof snapshot.currentRound === 'number') {
        setCurrentRound(snapshot.currentRound);
        setViewingRound(snapshot.currentRound || 1);
      }
      if (snapshot.pendingPlayers && Array.isArray(snapshot.pendingPlayers)) {
        setPendingPlayers(snapshot.pendingPlayers);
      }
      if (snapshot.config && typeof snapshot.config === 'object') {
        // v1.92: old (v1.91) snapshots lack format/straightPool — merge safe defaults
        setConfig({
          format: 'fixed_rack',
          ...snapshot.config,
          straightPool: { ...STRAIGHT_POOL_DEFAULTS, ...(snapshot.config.straightPool || {}) }
        });
      }
      if (snapshot.tournamentConfig && typeof snapshot.tournamentConfig === 'object') {
        setTournamentConfig(snapshot.tournamentConfig);
      }
      if (snapshot.preAdvanceSnapshot && typeof snapshot.preAdvanceSnapshot === 'object') {
        setPreAdvanceSnapshot(snapshot.preAdvanceSnapshot);
      }
      if (snapshot.clubDatabase && Array.isArray(snapshot.clubDatabase)) {
        setClubDatabase(snapshot.clubDatabase);
      }
      
      // Set appropriate view based on restored state
      if (snapshot.tournament && typeof snapshot.tournament === 'object') {
        if (snapshot.currentRound > 0) {
          setView('round'); // Active tournament - show round view
        } else {
          setView('players'); // Tournament configured but not started
        }
      } else if (snapshot.tournamentConfig) {
        setView('players'); // Tournament config exists but no tournament started
      }

      console.log('Tournament restored from autosave');
    } catch (error) {
      console.error('Failed to restore tournament:', error);
      // Silently fail - don't interrupt normal startup
    }
  }, []); // Run once on mount

  // Add player to tournament
  const addPlayerToTournament = () => {
    if (!newPlayer.name.trim()) return;

    const newPlayerId = Date.now();
    const newPlayerData = {
      id: newPlayerId,
      name: newPlayer.name,
      elo: parseInt(newPlayer.elo) || 1500
    };

    // Add to players list (global)
    const updatedPlayers = [...players, newPlayerData];
    setPlayers(updatedPlayers);

    // Add to pending players (will be seeded into next round)
    setPendingPlayers([...pendingPlayers, newPlayerData]);

    setNewPlayer({ name: '', elo: 1500 });
    setShowAddModal(false);
  };

  // Remove players from round
  const removePlayersFromRound = () => {
    if (playersToRemove.length === 0) {
      setErrorMessage('No players selected');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }

    const updatedPlayers = tournament.players.map(p =>
      playersToRemove.includes(p.id) ? { ...p, removed: true } : p
    );

    // Reconstruct complete, format-aware standings through rounds < currentRound,
    // then create pairings FIRST. Only mutate state if pairings are legal.
    const sorted = buildSortedStandingsBeforeRound(currentRound, updatedPlayers, allRounds);

    const newMatches = createPairings(sorted, 0, currentRound);
    if (newMatches === null) { setShowByeError(true); return; } // no legal bye (§9.2)

    setTournament({
      ...tournament,
      players: updatedPlayers
    });

    setAllRounds({
      ...allRounds,
      [currentRound]: newMatches
    });

    setPlayersToRemove([]);
    setShowRemovePlayerModal(false);
  };

  // Restore player
  const restorePlayer = (playerId) => {
    const updatedPlayers = tournament.players.map(p =>
      p.id === playerId ? { ...p, removed: false } : p
    );

    // Reconstruct complete, format-aware standings through rounds < currentRound,
    // create pairings FIRST, and only mutate state if pairings are legal.
    const sorted = buildSortedStandingsBeforeRound(currentRound, updatedPlayers, allRounds);

    const newMatches = createPairings(sorted, 0, currentRound);
    if (newMatches === null) { setShowByeError(true); return; } // no legal bye (§9.2)

    setTournament({
      ...tournament,
      players: updatedPlayers
    });

    setAllRounds({
      ...allRounds,
      [currentRound]: newMatches
    });
  };

  // Regenerate round pairings based on current standings
  const regenerateRound = (roundNum) => {
    // Reconstruct complete, format-aware standings through rounds < roundNum.
    const sorted = buildSortedStandingsBeforeRound(roundNum, tournament.players, allRounds);

    // Create fresh pairings
    const newMatches = createPairings(sorted, 0, roundNum);
    if (newMatches === null) { setShowByeError(true); return; } // no legal bye (§9.2)

    // Clear and replace the round completely
    setAllRounds({
      ...allRounds,
      [roundNum]: newMatches
    });
    
    setShowRegenerateConfirm(false);
    
    // Trigger recalculation
    setTimeout(() => recalc(), 100);
  };

  // Apply manual seeding to a round

  // Manual Pairing Editor (Fix #3) - Direct pairing manipulation
  const openManualPairingEditor = (roundNumber) => {
    const roundMatches = allRounds[roundNumber] || [];
    if (roundMatches.length === 0) return;
    
    // Convert matches to editable format
    const editablePairings = roundMatches.map(m => ({
      id: m.id,
      p1Id: m.p1.id,
      p2Id: m.p2.id,
      isBye: m.bye || false,
      originalP1: m.p1.name,
      originalP2: m.p2.name
    }));
    
    setManualPairingsData(editablePairings);
    setManualPairingsRound(roundNumber);
    setShowManualPairings(true);
  };

  const swapPlayersInPairings = (pairingIndex, playerSlot, newPlayerId) => {
    const updated = [...manualPairingsData];
    const pairing = updated[pairingIndex];
    
    if (playerSlot === 'p1') {
      pairing.p1Id = newPlayerId;
    } else {
      pairing.p2Id = newPlayerId;
    }
    
    setManualPairingsData(updated);
  };

  const validateManualPairings = () => {
    const warnings = [];
    const playersSeen = new Set();
    
    // Check for duplicate players and byes
    manualPairingsData.forEach((pairing, idx) => {
      if (!pairing.isBye) {
        if (playersSeen.has(pairing.p1Id)) {
          warnings.push(`Player ID ${pairing.p1Id} appears multiple times`);
        }
        if (playersSeen.has(pairing.p2Id)) {
          warnings.push(`Player ID ${pairing.p2Id} appears multiple times`);
        }
        playersSeen.add(pairing.p1Id);
        playersSeen.add(pairing.p2Id);
      } else {
        if (playersSeen.has(pairing.p1Id)) {
          warnings.push(`Bye player ${pairing.p1Id} also in a match`);
        }
        playersSeen.add(pairing.p1Id);
      }
    });
    
    // Check for repeat pairings from previous rounds
    const allPlayers = tournament.players.filter(p => !p.removed);
    manualPairingsData.forEach(pairing => {
      if (!pairing.isBye) {
        const p1 = allPlayers.find(p => p.id === pairing.p1Id);
        const p2 = allPlayers.find(p => p.id === pairing.p2Id);
        
        if (p1 && p2) {
          // Check if they've played before
          const hasPlayed = (p1.opps || []).includes(p2.id);
          if (hasPlayed) {
            warnings.push(`${p1.name} vs ${p2.name} is a repeat pairing`);
          }
        }
      }
    });
    
    // Check bye eligibility
    const byePairing = manualPairingsData.find(p => p.isBye);
    if (byePairing) {
      const byePlayer = allPlayers.find(p => p.id === byePairing.p1Id);
      if (byePlayer) {
        // Check if they had a bye before
        let hadByeBefore = false;
        Object.values(allRounds).forEach(roundMatches => {
          (roundMatches || []).forEach(m => {
            if (m.bye && m.p1.id === byePlayer.id && m.done) {
              hadByeBefore = true;
            }
          });
        });
        
        if (hadByeBefore) {
          warnings.push(`${byePlayer.name} already had a bye in a previous round`);
        }
        
        if (byePlayer.joinedRound === manualPairingsRound) {
          warnings.push(`${byePlayer.name} joined this round and should not get a bye`);
        }
      }
    }
    
    return warnings;
  };

  const applyManualPairings = () => {
    const warnings = validateManualPairings();
    
    if (warnings.length > 0) {
      // Show warnings in React modal instead of browser confirm()
      setManualPairingWarnings(warnings);
      setShowManualPairingWarnings(true);
      return;
    }
    
    // No warnings - proceed directly
    performApplyManualPairings();
  };
  
  // Execute manual pairing application (called after warning confirmation or directly if no warnings)
  const performApplyManualPairings = () => {
    // Convert manual pairings back to match format
    const allPlayers = tournament.players.filter(p => !p.removed);
    const newMatches = manualPairingsData.map((pairing, idx) => {
      const p1 = allPlayers.find(p => p.id === pairing.p1Id);
      const p2 = pairing.isBye 
        ? { id: 'bye', name: 'FREILOS', elo: 1300 }
        : allPlayers.find(p => p.id === pairing.p2Id);
      
      return {
        id: pairing.id,
        p1,
        p2,
        r1: pairing.isBye ? config.max_games : 0,
        r2: 0,
        done: pairing.isBye,
        cancelled: false,
        bye: pairing.isBye,
        tbl: idx + 1
      };
    });
    
    // Update the round
    setAllRounds({
      ...allRounds,
      [manualPairingsRound]: newMatches
    });
    
    setShowManualPairings(false);
    setManualPairingsData([]);
    setShowManualPairingWarnings(false);
    setManualPairingWarnings([]);
    
    setTimeout(() => recalc(), 100);
  };


  // === EXPORT GENERATION (Regenerates When Final Results Viewed) ===
  // Generate exports when user views Final Results
  // Regenerates whenever tournament data changes to ensure fresh exports
  useEffect(() => {
    // Only generate if tournament is complete and user is viewing Final Results
    if (!tournament || !tournamentConfig || view !== 'results') {
      return;
    }

    try {
      console.log('Generating exports for Final Results...');
      
      // Clean up old blob URLs before creating new ones
      if (exportResultsURL) URL.revokeObjectURL(exportResultsURL);
      if (exportELOsURL) URL.revokeObjectURL(exportELOsURL);

      // Generate Final Results CSV with tournament metadata
      const sorted = [...tournament.players]
        .map(p => {
          const startElo = players.find(pl => pl.id === p.id)?.elo || p.elo;
          return {
            ...p,
            startElo,
            avgPerf: p.perfCount > 0 ? p.perf / p.perfCount : 0
          };
        })
        .sort(compareRankings);

      // Add tournament metadata header for archiving
      const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      let resultsCsv = '';
      
      // Metadata section (Google Sheets will preserve this)
      resultsCsv += `Tournament Name:,"${tournamentConfig?.title || 'Pool Tournament'}"\n`;
      resultsCsv += `Date:,${currentDate}\n`;
      resultsCsv += `Format:,${isStraightPool() ? 'Straight Pool 14.1 — GBR_14.1 Experimental' : 'Fixed-Rack Pool'}\n`;
      resultsCsv += `Total Rounds:,${tournament.totalRounds}\n`;
      resultsCsv += `Total Players:,${sorted.length}\n`;
      resultsCsv += `Ranking System:,${isStraightPool() ? (config.ranking_system === 'racks' ? 'Point Differential 14.1 (MP -> Point Diff -> 14.1 PERF -> GD -> HS)' : 'Classic 14.1 (MP -> 14.1 PERF -> Point Diff -> GD -> HS)') : (config.ranking_system === 'classic' ? 'Classic (MP -> Perf -> ID)' : 'Rack Differential')}\n`;
      resultsCsv += `Prestige Score:,${config.use_rp ? 'Enabled' : 'Disabled'}\n`;
      resultsCsv += `Event Score:,${config.use_rank ? 'Enabled' : 'Disabled'}\n`;
      if (isStraightPool()) {
        const tsp = getSP();
        const w = normalizeWeights(tsp);
        resultsCsv += `R1 Target:,${tsp.startTarget}\n`;
        resultsCsv += `Tier Targets:,"${(tsp.tierTargets || []).join(' / ')}"\n`;
        resultsCsv += `Tiering Starts Round:,${tsp.tieringStartsRound}\n`;
        resultsCsv += `K_14.1:,${tsp.k_14_1}\n`;
        resultsCsv += `Weights (Margin/GD/HS):,"${Math.round(w.marginWeight*100)} / ${Math.round(w.bpiWeight*100)} / ${Math.round(w.highRunWeight*100)}"\n`;
      }
      resultsCsv += `\n`; // Blank line separator
      
      // Results table header - REORGANIZED for logical flow
      resultsCsv += 'Placement,Name';
      
      // Round columns first
      for (let r = 1; r <= tournament.totalRounds; r++) {
        resultsCsv += `,R${r}`;
      }
      
      // Then totals
      resultsCsv += ',Match Points';
      if (config.use_rp) {
        resultsCsv += ',Prestige';
      }
      if (config.use_rank) {
        resultsCsv += ',Event Score';
      }
      
      // Then details (14.1 mode reports points-based aggregates instead of racks)
      const sp141 = isStraightPool();
      if (sp141) {
        resultsCsv += ',Games,P+,P-,Point Diff,GD,HGD,HS';
      } else {
        resultsCsv += ',Games,Racks Won,Racks Lost,Rack Diff';
      }
      
      // Then performance
      resultsCsv += sp141 ? ',14.1 PERF' : ',Avg Performance';
      
      // Finally ELO progression
      resultsCsv += ',Start GBR,Final GBR,GBR Change';
      resultsCsv += '\n';
      
      sorted.forEach((p, i) => {
        const rackDiff = (p.racksWon || 0) - (p.racksLost || 0);
        const eloChange = Math.round(p.elo - p.startElo);
        
        // 1. Identity
        resultsCsv += `${i + 1},`;
        resultsCsv += `"${p.name}"`;
        
        // 2. Round-by-round results
        for (let r = 1; r <= tournament.totalRounds; r++) {
          const matches = allRounds[r] || [];
          const match = matches.find(m => m.p1.id === p.id || m.p2.id === p.id);
          let points = '-';
          
          if (match && match.done && !match.cancelled) {
            if (match.bye && match.p1.id === p.id) {
              points = sp141 ? '1 (BYE)' : '1'; // bye = 1 MP (whitepaper §9.3)
            } else if (match.format === 'straight_pool_14_1') {
              // Compact 14.1 notation: "1 (40-22, I:10, HR:14)"
              const isP1 = match.p1.id === p.id;
              const mine = isP1 ? (match.p1Points || 0) : (match.p2Points || 0);
              const opp = isP1 ? (match.p2Points || 0) : (match.p1Points || 0);
              const hr = isP1 ? (match.p1HighRun || 0) : (match.p2HighRun || 0);
              const mpVal = mine > opp ? '1' : mine === opp ? '0.5' : '0';
              points = `"${mpVal} (${mine}-${opp}, I:${match.innings || 0}, HS:${hr})"`;
            } else if (match.p1.id === p.id) {
              points = match.r1 > match.r2 ? '1' : match.r1 === match.r2 ? '0.5' : '0';
            } else if (match.p2.id === p.id) {
              points = match.r2 > match.r1 ? '1' : match.r2 === match.r1 ? '0.5' : '0';
            }
          } else if ((p.joinedRound || 1) > r) {
            points = '-'; // Player hadn't joined yet
          }
          
          resultsCsv += `,${points}`;
        }
        
        // 3. Totals
        resultsCsv += `,${p.mp}`;
        if (config.use_rp) {
          resultsCsv += `,${Math.round(p.rp || 0)}`;
        }
        if (config.use_rank) {
          resultsCsv += `,${calcRank(p, sorted, tournament, clubDatabase)}`;
        }
        
        // 4. Details
        if (sp141) {
          const gd = p.inningsTotal > 0 ? (p.pointsFor / p.inningsTotal) : 0;
          const pd = (p.pointsFor || 0) - (p.pointsAgainst || 0);
          resultsCsv += `,${p.games}`;
          resultsCsv += `,${p.pointsFor || 0}`;
          resultsCsv += `,${p.pointsAgainst || 0}`;
          resultsCsv += `,${pd >= 0 ? '+' : ''}${pd}`;
          resultsCsv += `,${gd.toFixed(3)}`;
          resultsCsv += `,${(p.hgd || 0).toFixed(3)}`;
          resultsCsv += `,${p.hs || 0}`;
        } else {
          resultsCsv += `,${p.games}`;
          resultsCsv += `,${p.racksWon || 0}`;
          resultsCsv += `,${p.racksLost || 0}`;
          resultsCsv += `,${rackDiff}`;
        }
        
        // 5. Performance
        resultsCsv += `,${Math.round(p.avgPerf)}`;
        
        // 6. ELO progression
        resultsCsv += `,${Math.round(p.startElo)}`;
        resultsCsv += `,${Math.round(p.elo)}`;
        resultsCsv += `,${eloChange >= 0 ? '+' : ''}${eloChange}`;
        
        resultsCsv += '\n';
      });

      // ===== Section 3: Individual Matches =====
      // Replay rounds in order to derive per-match GBR before/after/change & PERF.
      resultsCsv += '\n';
      resultsCsv += 'Individual Matches\n';
      if (isStraightPool()) {
        resultsCsv += 'Round,Table,Target,Player A,Player B,A Points,B Points,Innings,A HS,B HS,A GD,B GD,A MP,B MP,A 14.1 PERF,B 14.1 PERF,A GBR Before,B GBR Before,A GBR Change,B GBR Change,A GBR After,B GBR After\n';
      } else {
        resultsCsv += 'Round,Table,Player A,Player B,A Racks,B Racks,A MP,B MP,A PERF,B PERF,A GBR Before,B GBR Before,A GBR Change,B GBR Change,A GBR After,B GBR After\n';
      }
      // Running GBR map seeded from each player's starting GBR
      const runningGbr = {};
      tournament.players.forEach(p => {
        runningGbr[p.id] = players.find(pl => pl.id === p.id)?.elo ?? p.elo;
      });
      const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
      for (let r = 1; r <= currentRound; r++) {
        (allRounds[r] || []).forEach(m => {
          if (!m.done || m.cancelled) return;
          if (m.bye) {
            // Bye: 1 MP, no GBR/points change
            const gbrA = Math.round(runningGbr[m.p1.id] ?? m.p1.elo);
            if (isStraightPool()) {
              resultsCsv += `${r},${q(m.tbl ?? '')},${m.target || ''},${q(m.p1.name)},BYE,,,,,,,,1,,,,${gbrA},,0,,${gbrA},\n`;
            } else {
              resultsCsv += `${r},${q(m.tbl ?? '')},${q(m.p1.name)},BYE,,,1,,,,${gbrA},,0,,${gbrA},\n`;
            }
            return;
          }
          const gA = runningGbr[m.p1.id] ?? m.p1.elo;
          const gB = runningGbr[m.p2.id] ?? m.p2.elo;
          if (m.format === 'straight_pool_14_1') {
            const PA = Number(m.p1Points) || 0, PB = Number(m.p2Points) || 0;
            const inn = Number(m.innings) || 0;
            const HRA = Number(m.p1HighRun) || 0, HRB = Number(m.p2HighRun) || 0;
            const tgt = m.target || getSP().startTarget;
            const sigA = calcStraightPoolSignals(PA, PB, inn, HRA, HRB, tgt, getSP());
            const sigB = calcStraightPoolSignals(PB, PA, inn, HRB, HRA, tgt, getSP());
            const perfA = calcStraightPoolPerf(gB, sigA.s141);
            const perfB = calcStraightPoolPerf(gA, sigB.s141);
            const ch = calcStraightPoolGbrChange(gA, gB, { p1Points: PA, p2Points: PB, innings: inn, p1HighRun: HRA, p2HighRun: HRB, target: tgt });
            const mpA = PA > PB ? 1 : PA === PB ? 0.5 : 0;
            const mpB = PB > PA ? 1 : PB === PA ? 0.5 : 0;
            const gdA = inn > 0 ? (PA / inn).toFixed(2) : '0.00';
            const gdB = inn > 0 ? (PB / inn).toFixed(2) : '0.00';
            const afterA = Math.round(gA + ch), afterB = Math.round(gB - ch);
            resultsCsv += [r, q(m.tbl ?? ''), tgt, q(m.p1.name), q(m.p2.name), PA, PB, inn, HRA, HRB, gdA, gdB, mpA, mpB,
              perfA, perfB, Math.round(gA), Math.round(gB), `${ch >= 0 ? '+' : ''}${Math.round(ch)}`, `${-ch >= 0 ? '+' : ''}${Math.round(-ch)}`, afterA, afterB].join(',') + '\n';
            runningGbr[m.p1.id] = gA + ch;
            runningGbr[m.p2.id] = gB - ch;
          } else {
            const ch = calcEloChange(gA, gB, m.r1, m.r2);
            const perfA = calcPerformanceElo(gB, m.r1, m.r2);
            const perfB = calcPerformanceElo(gA, m.r2, m.r1);
            const mpA = m.r1 > m.r2 ? 1 : m.r1 === m.r2 ? 0.5 : 0;
            const mpB = m.r2 > m.r1 ? 1 : m.r2 === m.r1 ? 0.5 : 0;
            const afterA = Math.round(gA + ch), afterB = Math.round(gB - ch);
            resultsCsv += [r, q(m.tbl ?? ''), q(m.p1.name), q(m.p2.name), m.r1, m.r2, mpA, mpB,
              perfA, perfB, Math.round(gA), Math.round(gB), `${ch >= 0 ? '+' : ''}${Math.round(ch)}`, `${-ch >= 0 ? '+' : ''}${Math.round(-ch)}`, afterA, afterB].join(',') + '\n';
            runningGbr[m.p1.id] = gA + ch;
            runningGbr[m.p2.id] = gB - ch;
          }
        });
      }

      // Create blob URL and store in state
      const resultsBlob = new Blob([resultsCsv], { type: 'text/csv' });
      const resultsURL = URL.createObjectURL(resultsBlob);
      setExportResultsURL(resultsURL);

      // Generate Updated GBR database CSV (merges with club database if available)
      let elosCsv = 'Name,GBR\n';
      
      if (clubDatabase && clubDatabase.length > 0) {
        // Create a map of updated ELOs from tournament players
        const updatedELOs = {};
        tournament.players.forEach(p => {
          updatedELOs[p.name] = Math.round(p.elo);
        });
        
        // Start with club database players (update ELOs for participants)
        const playerMap = {};
        clubDatabase.forEach(dbPlayer => {
          playerMap[dbPlayer.name] = {
            name: dbPlayer.name,
            elo: updatedELOs[dbPlayer.name] !== undefined 
              ? updatedELOs[dbPlayer.name]  // Use updated ELO if player participated
              : Math.round(dbPlayer.elo)     // Use original ELO if player didn't participate
          };
        });
        
        // Add any NEW players from tournament who weren't in club database
        tournament.players.forEach(p => {
          if (!playerMap[p.name]) {
            playerMap[p.name] = {
              name: p.name,
              elo: Math.round(p.elo)
            };
          }
        });
        
        // Convert to array and sort by ELO descending
        const sortedPlayers = Object.values(playerMap)
          .sort((a, b) => b.elo - a.elo);
        
        // Export sorted list
        sortedPlayers.forEach(p => {
          elosCsv += `"${p.name}",${p.elo}\n`;
        });
      } else {
        // No club database - just export tournament players sorted by ELO
        const sortedPlayers = [...tournament.players]
          .map(p => ({ name: p.name, elo: Math.round(p.elo) }))
          .sort((a, b) => b.elo - a.elo); // Sort by ELO descending
        
        sortedPlayers.forEach(p => {
          elosCsv += `"${p.name}",${p.elo}\n`;
        });
      }

      // Create blob URL and store in state
      const elosBlob = new Blob([elosCsv], { type: 'text/csv' });
      const elosURL = URL.createObjectURL(elosBlob);
      setExportELOsURL(elosURL);

      // (v1.93) Image export removed — CSV export is the supported export format.

    } catch (error) {
      console.error('Error generating exports:', error);
    }

    // Cleanup function - revoke blob URLs when component unmounts
    return () => {
      if (exportResultsURL) URL.revokeObjectURL(exportResultsURL);
      if (exportELOsURL) URL.revokeObjectURL(exportELOsURL);
    };
  }, [tournament, tournamentConfig, view, config, players, allRounds, clubDatabase]);


  // Edit tournament title
  const startEditingTitle = () => {
    setTempTitle(tournamentConfig?.title || '');
    setEditingTitle(true);
  };

  const saveTitle = () => {
    if (tempTitle.trim()) {
      setTournamentConfig({
        ...tournamentConfig,
        title: tempTitle.trim()
      });
    }
    setEditingTitle(false);
  };

  const cancelEditTitle = () => {
    setEditingTitle(false);
    setTempTitle('');
  };

  // Next round
  const nextRound = () => {
    if (!(allRounds[currentRound] || []).every(m => m.done || m.cancelled)) {
      return alert('Complete all matches');
    }
    if (currentRound >= tournament.totalRounds) {
      setView('results');
      return;
    }

    // SAVE SNAPSHOT BEFORE ADVANCING - allows emergency undo of round advance
    setPreAdvanceSnapshot({
      tournament: JSON.parse(JSON.stringify(tournament)),
      allRounds: JSON.parse(JSON.stringify(allRounds)),
      currentRound: currentRound,
      viewingRound: viewingRound,
      pendingPlayers: JSON.parse(JSON.stringify(pendingPlayers))
    });

    const next = currentRound + 1;

    // Get current standings sorted by pairing order (format-aware: 14.1 uses the
    // 14.1 comparator). tournament.players already carries full recalc standings.
    let sorted = [...tournament.players]
      .filter(p => !p.removed)
      .map(p => ({
        ...p,
        avgPerf: p.perfCount > 0 ? p.perf / p.perfCount : 0
      }))
      .sort(comparePairingOrder);

    // Splice in pending players based on their ELO vs existing players' avgPerf
    const newTournamentPlayers = [];
    
    pendingPlayers.forEach(pendingPlayer => {
      // Create tournament player object
      const tournamentPlayer = {
        id: pendingPlayer.id,
        name: pendingPlayer.name,
        elo: pendingPlayer.elo,
        mp: 0,
        perf: 0,
        perfCount: 0,
        games: 0,
        racksWon: 0,
        racksLost: 0,
        opps: [],
        removed: false,
        joinedRound: next,
        avgPerf: 0
      };
      
      if (sorted.length === 0) {
        // If no existing players, just add to the list
        sorted.push(tournamentPlayer);
      } else {
        // Find the player with closest avgPerf to this pending player's ELO
        let closestIndex = 0;
        let closestDiff = Math.abs(sorted[0].avgPerf - pendingPlayer.elo);
        
        for (let i = 1; i < sorted.length; i++) {
          const diff = Math.abs(sorted[i].avgPerf - pendingPlayer.elo);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestIndex = i;
          }
        }
        
        // Insert right after the closest match
        sorted.splice(closestIndex + 1, 0, tournamentPlayer);
      }
      
      newTournamentPlayers.push(tournamentPlayer);
    });

    // Create pairings from augmented seeding list FIRST. Do not advance round
    // state or mutate tournament/pending until we know pairings are legal.
    const matches = createPairings(sorted, 0, next);
    if (matches === null) {
      // No legal bye: show modal and leave tournament in its current (un-advanced)
      // state — do not setCurrentRound/viewingRound, do not clear pendingPlayers,
      // do not mutate tournament players.
      setShowByeError(true);
      return;
    }

    // Pairings are valid — now commit the advance.
    if (newTournamentPlayers.length > 0) {
      setTournament({
        ...tournament,
        players: [...tournament.players, ...newTournamentPlayers]
      });
    }
    setAllRounds({ ...allRounds, [next]: matches });
    setCurrentRound(next);
    setViewingRound(next);
    setPendingPlayers([]);
  };

  // Undo advance - revert to state before "Next Round" was pressed
  const confirmUndoAdvance = () => {
    if (!preAdvanceSnapshot) {
      setErrorMessage('No snapshot available to revert');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }

    try {
      // Restore exact state from snapshot
      setTournament(preAdvanceSnapshot.tournament);
      setAllRounds(preAdvanceSnapshot.allRounds);
      setCurrentRound(preAdvanceSnapshot.currentRound);
      setViewingRound(preAdvanceSnapshot.viewingRound);
      setPendingPlayers(preAdvanceSnapshot.pendingPlayers);
      
      // Clear snapshot after successful restore
      setPreAdvanceSnapshot(null);
      setShowUndoAdvanceConfirm(false);
      
      setErrorMessage('Round advance cancelled - reverted to previous state');
      setTimeout(() => setErrorMessage(''), 3000);
    } catch (error) {
      console.error('Failed to revert round advance:', error);
      setErrorMessage('Failed to revert round advance');
      setTimeout(() => setErrorMessage(''), 3000);
    }
  };

  // Parse CSV file
  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n').filter(line => line.trim());
      
      // Detect separator (comma or tab)
      const firstLine = lines[0];
      const separator = firstLine.includes('\t') ? '\t' : ',';
      
      // Helper function to strip quotes from CSV values
      const stripQuotes = (str) => {
        const trimmed = str.trim();
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
          return trimmed.slice(1, -1);
        }
        return trimmed;
      };
      
      const parsed = lines.slice(1).map((line, index) => {
        const parts = line.split(separator).map(p => stripQuotes(p));
        return {
          id: Date.now() + index,
          name: parts[0] || '',
          elo: parseInt(parts[1]) || 1500
        };
      }).filter(p => p.name); // Remove empty entries

      setTempClubData(parsed);
    };
    reader.readAsText(file);
  };

  // Save club database
  const saveClubDatabase = () => {
    setClubDatabase(tempClubData);
    setShowClubDatabaseModal(false);
    alert(`✓ Club database saved with ${tempClubData.length} players!`);
  };

  // Update temp club data
  const updateTempClubPlayer = (id, field, value) => {
    setTempClubData(tempClubData.map(p => 
      p.id === id ? { ...p, [field]: field === 'elo' ? parseInt(value) || 1500 : value } : p
    ));
  };

  // Delete temp club player
  const deleteTempClubPlayer = (id) => {
    setTempClubData(tempClubData.filter(p => p.id !== id));
  };

  // Clear autosave confirmation handler
  const confirmClearAutosave = () => {
    try {
      localStorage.removeItem('poolTournamentAutosave');
      setShowClearAutosaveConfirm(false);
      setErrorMessage('Autosave cleared');
      setTimeout(() => setErrorMessage(''), 3000);
    } catch (error) {
      console.error('Failed to clear autosave:', error);
      setErrorMessage('Failed to clear autosave');
      setTimeout(() => setErrorMessage(''), 3000);
    }
  };

  // Save current config as preset
  const saveConfigPreset = () => {
    if (!newPresetName.trim()) {
      setErrorMessage('Please enter a preset name');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }
    
    const newPreset = {
      name: newPresetName.trim(),
      ...config
    };
    
    setConfigPresets([...configPresets, newPreset]);
    setNewPresetName('');
    setErrorMessage('');
  };

  // Load config preset
  const loadConfigPreset = (preset) => {
    const { name, ...presetConfig } = preset;
    setConfig(presetConfig);
    setShowConfigPresets(false);
  };

  // Delete config preset
  const deleteConfigPreset = (index) => {
    setConfigPresets(configPresets.filter((_, i) => i !== index));
  };

  // Import seeding order from CSV
  const handleSeedingCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n').filter(line => line.trim());
      
      // Detect separator (comma or tab)
      const separator = lines[0].includes('\t') ? '\t' : ',';
      
      // Helper function to strip quotes from CSV values
      const stripQuotes = (str) => {
        const trimmed = str.trim();
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
          return trimmed.slice(1, -1);
        }
        return trimmed;
      };
      
      // Skip header if it exists (check if first line looks like a header)
      const startIndex = lines[0].toLowerCase().includes('name') || lines[0].toLowerCase().includes('player') ? 1 : 0;
      
      // Parse names in order
      const orderedNames = lines.slice(startIndex).map(line => {
        const parts = line.split(separator);
        return stripQuotes(parts[0]); // Take first column as name, strip quotes
      }).filter(name => name);

      // Match names to player IDs
      const orderedIds = [];
      const notFound = [];
      
      orderedNames.forEach(csvName => {
        const player = players.find(p => 
          p.name.toLowerCase().trim() === csvName.toLowerCase().trim()
        );
        if (player) {
          orderedIds.push(player.id);
        } else {
          notFound.push(csvName);
        }
      });

      if (notFound.length > 0) {
        setErrorMessage(`Warning: Could not find ${notFound.length} player(s): ${notFound.join(', ')}`);
        setTimeout(() => setErrorMessage(''), 5000);
      }

      if (orderedIds.length > 0) {
        setManualSeeding(orderedIds);
        setSeedMethod('manual');
        setShowSeedingImport(false);
        setErrorMessage('');
      }
    };
    reader.readAsText(file);
  };

  // Abort tournament and reset to initial state
  const abortTournament = () => {
    // Clear autosave when aborting tournament
    localStorage.removeItem('poolTournamentAutosave');
    
    // Reset tournament state but preserve players and club database
    setTournament(null);
    setTournamentConfig(null);
    setCurrentRound(0);
    setViewingRound(1);
    setAllRounds({});
    setView('tournament');
    setShowAbortConfirm(false);
    setTournamentTitle('');
    setPendingPlayers([]); // Clear pending players
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <img 
                src="data:image/png;base64,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RI4lkUigtrYW11xzDU2ZMsV8T7LBlNv68fkXi8WyDiyvv/56mfiXLfJYxBeLReRyORx99NG+aC8AaG5uRk1NjdmODWIdMew4juP7v2Du3LloamraZwOMJJlMGiHP39scXdXc3GzmJhKJGGNKOp1GNps9IN9jiqJ8clADgKIon1r44ZUftK6++mq6/fbb0a1bN98DrPREAi0PoyzApbdX5sTyAzc/YMmHvKA3sdK45MM4i18WtnIfLKy+853v4POf/zz90z/9ExYuXLjfCjcej/s8rkCL8JSebva2siC1bRuZTKYqAcDbFAoFcw6WZaG5udmcI/emlp41notkMukThPygz0gveNCI0Bkh4nyOHG3ABpD99ewyiUQCjuOgf//+NGjQIEycOBHDhg0DgLIUCXnua9euNdt+HEQiEdi2beYjkUjgiSeesI488kjccsstdMMNNyCVShkBzR7c9uD7IyhG5P0HtBgfeP7/9Kc/0dlnn211poc9Go2id+/ePo9xNV7uDRs2oFgsQrZ243u5M9YIFxb94he/aEQvRxcExaO8FxsbG7Ft2za8+eabFu+HPxM0lLUFf5bv3Ugkgp49ewJojX5oCzZeOY5Tdo35vjrqqKMwZMgQGj58OE466SQMGDAAAwYMQI8ePXzfn/xdIscuv795TCx6ly5dasnry9+j0njmuq6JruFryMamYrFoiusVi0WzBjtSf0WuDcdxsHHjRtx1113mmuyvAJcefs/zzPc5G6P4PEulkvke5+97rQGgKIc2agBQFOVTCz8clUolXHnllXTfffeZkHZ+gOWHzOADdVhIbbAqNtDyEFZTU1Mm9mWYKgsn9jxJb54U/Cxe+eE4n8+bUHwWy/3798fcuXPx3e9+l+655x5LhmmzJ1mee1vww2Dwd/lgms/nEYlEQESwbRuJRAINDQ1VCSRZ7V8+8PLY+Jhy7uU4+KGfBZkUJFIEBB9m4/F4p4hjaQjhh2u+3tWIROmVXbZsGfr370+9evXC+PHjcdxxx2HAgAE45ZRTUFtb61s/wdQAaRAiImzatOljE/98HgwRmXson8/jpptush5++GH6f//v/+GKK67weWTltsG5ChpzotGoL+pBGt84EiGdTmPkyJE4+eSTadmyZZ2qYHr27FkWXt4efH85jmOMW9LT3p6HV15jNujwfvi74LrrrqPu3bubCCY5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" 
                alt="Club Logo"
                style={{
                  maxHeight: '100px',
                  height: 'auto',
                  width: 'auto',
                  objectFit: 'contain'
                }}
              />
              Batforce Billiards System
              <span className="text-sm text-slate-400 font-normal ml-2">v1.92</span>
              <span className="block text-xs text-slate-400 font-normal mt-1">BBS @ Potapov &amp; Hempel</span>
            </h1>
            <div className="flex gap-3">
              <button
                onClick={() => setShowClubDatabaseModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                title="Club Database"
              >
                <User className="w-5 h-5" />
                Club Database
              </button>
              {tournament && (
                <button
                  onClick={() => setShowAbortConfirm(true)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
                  title="Cancel Tournament"
                >
                  <XCircle className="w-4 h-4" />
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          {/* Tournament tab - always visible */}
          <button
            onClick={() => setView('tournament')}
            className={`px-4 py-2 rounded-lg ${view === 'tournament' ? 'bg-blue-600' : 'bg-slate-700'} text-white`}
          >
            Tournament
          </button>
          
          {/* Players tab - only after tournament config created */}
          {tournamentConfig && (
            <button
              onClick={() => setView('players')}
              className={`px-4 py-2 rounded-lg ${view === 'players' ? 'bg-blue-600' : 'bg-slate-700'} text-white`}
            >
              Players
            </button>
          )}
          
          {/* Round tabs - only after tournament started */}
          {tournament && [...Array(currentRound)].map((_, i) => (
            <button
              key={i}
              onClick={() => { setView('round'); setViewingRound(i + 1); }}
              className={`px-4 py-2 rounded-lg ${view === 'round' && viewingRound === i + 1 ? 'bg-blue-600' : 'bg-slate-700'} text-white`}
            >
              Round {i + 1}
            </button>
          ))}
          
          {/* All Rounds tab - only after tournament started */}
          {tournament && (
            <button
              onClick={() => setView('allRounds')}
              className={`px-4 py-2 rounded-lg ${view === 'allRounds' ? 'bg-blue-600' : 'bg-slate-700'} text-white`}
            >
              All Rounds
            </button>
          )}
          
          {/* Ranking tab - only after tournament started */}
          {tournament && (
            <button
              onClick={() => setView('results')}
              className={`px-4 py-2 rounded-lg ${view === 'results' ? 'bg-blue-600' : 'bg-slate-700'} text-white`}
            >
              Ranking
            </button>
          )}
        </div>

        {/* Secondary navigation bar for specific tab actions */}
        {view === 'players' && tournamentConfig && !tournament && (
          <div className="flex gap-2 mb-6 flex-wrap">
            <button
              onClick={() => setShowSeedingModal(true)}
              disabled={players.length < 2}
              className="px-4 py-2 rounded-lg flex items-center gap-2 bg-slate-600 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Target className="w-4 h-4" />
              Round 1 Seed
            </button>
            <button
              onClick={() => setShowTableConfig(!showTableConfig)}
              className="px-4 py-2 rounded-lg flex items-center gap-2 bg-blue-600 text-white hover:opacity-90"
            >
              <Table className="w-4 h-4" />
              Table Numbers
            </button>
          </div>
        )}
        
        {/* Round-specific actions */}
        {view === 'round' && tournament && (
          <div className="flex gap-2 mb-6 flex-wrap">
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              Add Player
            </button>
            <button
              onClick={() => setShowRemovePlayerModal(true)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
            >
              <UserMinus className="w-4 h-4" />
              Remove Player
            </button>
            <button
              onClick={() => {
                setShowRegenerateConfirm(true);
                setRegenerateRoundNum(viewingRound);
              }}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-2"
            >
              <RotateCw className="w-4 h-4" />
              Regenerate Pairings
            </button>
          </div>
        )}

        {showTableConfig && (
          <div className="bg-slate-800 rounded-lg p-6 mb-6 border border-slate-700">
            <h2 className="text-xl font-bold text-white mb-3">Configure Table Numbers</h2>
            <p className="text-slate-300 text-sm mb-3">
              Set custom table numbers/names for {Math.ceil((tournament ? tournament.players.filter(p => !p.removed).length : players.length) / 2)} matches
            </p>
            <div className="grid grid-cols-6 gap-2 mb-4">
              {[...Array(Math.ceil((tournament ? tournament.players.filter(p => !p.removed).length : players.length) / 2))].map((_, i) => (
                <input
                  key={i}
                  type="text"
                  placeholder={`Table ${i + 1}`}
                  value={tableNumbers[i] || ''}
                  onChange={e => {
                    const newTables = [...tableNumbers];
                    newTables[i] = e.target.value;
                    setTableNumbers(newTables);
                  }}
                  className="px-3 py-2 bg-slate-600 text-white rounded text-center"
                />
              ))}
            </div>
            <div className="flex gap-3">
              {tournament && currentRound > 0 && (
                <button
                  onClick={() => {
                    const matches = allRounds[currentRound] || [];
                    const updated = matches.map((m, idx) => ({
                      ...m,
                      tbl: tableNumbers[idx] || (idx + 1)
                    }));
                    setAllRounds({ ...allRounds, [currentRound]: updated });
                    setShowTableConfig(false);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Apply to Round {currentRound}
                </button>
              )}
              <button
                onClick={() => setTableNumbers([])}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Reset to Default
              </button>
              <button
                onClick={() => setShowTableConfig(false)}
                className="px-4 py-2 bg-slate-600 text-white rounded hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* TOURNAMENT VIEW */}
        {view === 'tournament' && (
          <div className="space-y-6">
            {!tournamentConfig ? (
              /* CREATE TOURNAMENT FORM */
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <h2 className="text-2xl font-bold text-white mb-6">Create New Tournament</h2>
                
                {/* Tournament Title */}
                <div className="mb-6">
                  <label className="text-white block mb-2 font-semibold">Tournament Title:</label>
                  <input
                    type="text"
                    placeholder="Enter tournament name (e.g., Friday Night Pool League)"
                    value={tournamentTitle}
                    onChange={e => setTournamentTitle(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg"
                  />
                </div>

                {/* Config Presets */}
                <div className="mb-6 bg-slate-700 p-4 rounded-lg">
                  <h3 className="text-white font-bold mb-3">Load Preset Configuration:</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {configPresets.map((preset, index) => (
                      <button
                        key={index}
                        onClick={() => {
                          const { name, ...presetConfig } = preset;
                          setConfig(presetConfig);
                        }}
                        className="p-3 bg-slate-600 hover:bg-slate-500 rounded-lg text-white text-left"
                      >
                        <div className="font-semibold mb-1">{preset.name}</div>
                        <div className="text-xs text-slate-300">
                          {preset.default_rounds} rounds • {preset.max_games} racks
                          {preset.use_rp && ' • RP ✓'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* v1.92: Tournament Format selector */}
                <div className="mb-6 bg-slate-700 p-4 rounded-lg">
                  <h3 className="text-white font-bold mb-3">Tournament Format</h3>
                  <div className="flex gap-3 flex-wrap">
                    <button
                      onClick={() => setConfig({ ...config, format: 'fixed_rack' })}
                      className={`px-4 py-2 rounded-lg font-semibold ${config.format !== 'straight_pool_14_1' ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-300'}`}
                    >
                      Fixed-Rack Pool
                    </button>
                    <button
                      onClick={() => setConfig({ ...config, format: 'straight_pool_14_1', straightPool: { ...STRAIGHT_POOL_DEFAULTS, ...(config.straightPool || {}), enabled: true } })}
                      className={`px-4 py-2 rounded-lg font-semibold ${config.format === 'straight_pool_14_1' ? 'bg-amber-600 text-white' : 'bg-slate-600 text-slate-300'}`}
                    >
                      Straight Pool 14.1 — GBR_14.1 Experimental
                    </button>
                  </div>
                  {config.format === 'straight_pool_14_1' && (
                    <p className="text-amber-200 text-xs mt-3">
                      Experimental 14.1 mode uses score, innings, and high runs to calculate a
                      14.1-specific performance signal. Fixed-rack GBR behavior is unchanged.
                    </p>
                  )}
                </div>

                {/* v1.92: 14.1 Experimental settings (only when 14.1 selected) */}
                {config.format === 'straight_pool_14_1' && (
                  <div className="mb-6 bg-slate-700 p-4 rounded-lg border border-amber-700">
                    <h3 className="text-amber-300 font-bold mb-3">GBR_14.1 Experimental Settings</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        ['R1 Race Target', 'startTarget'],
                        ['Tiering Starts Round', 'tieringStartsRound'],
                        ['Tier 1 Target', 'tier0'],
                        ['Tier 2 Target', 'tier1'],
                        ['Tier 3 Target', 'tier2'],
                        ['Target Reference', 'targetReference'],
                        ['K_14.1', 'k_14_1'],
                        ['Margin Weight', 'marginWeight'],
                        ['GD / Inning Efficiency Weight', 'bpiWeight'],
                        ['High Run Weight', 'highRunWeight'],
                      ].map(([label, key]) => {
                        const sp = { ...STRAIGHT_POOL_DEFAULTS, ...(config.straightPool || {}) };
                        const tierIdx = key === 'tier0' ? 0 : key === 'tier1' ? 1 : key === 'tier2' ? 2 : null;
                        const val = tierIdx !== null ? (sp.tierTargets[tierIdx] ?? '') : sp[key];
                        const step = ['marginWeight', 'bpiWeight', 'highRunWeight'].includes(key) ? '0.05' : '1';
                        return (
                          <div key={key}>
                            <label className="text-white block mb-1 text-xs">{label}</label>
                            <input
                              type="number"
                              step={step}
                              value={val}
                              onChange={e => {
                                const num = parseFloat(e.target.value);
                                const next = { ...STRAIGHT_POOL_DEFAULTS, ...(config.straightPool || {}) };
                                if (tierIdx !== null) {
                                  const tt = [...next.tierTargets];
                                  tt[tierIdx] = isNaN(num) ? 0 : num;
                                  next.tierTargets = tt;
                                } else {
                                  next[key] = isNaN(num) ? 0 : num;
                                }
                                setConfig({ ...config, straightPool: next });
                              }}
                              className="w-full px-2 py-1 bg-slate-600 text-white rounded text-sm"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <label className="flex items-center gap-2 mt-3 text-white text-sm">
                      <input
                        type="checkbox"
                        checked={(config.straightPool || STRAIGHT_POOL_DEFAULTS).useTargetScaledK !== false}
                        onChange={e => setConfig({ ...config, straightPool: { ...STRAIGHT_POOL_DEFAULTS, ...(config.straightPool || {}), useTargetScaledK: e.target.checked } })}
                      />
                      Use target-scaled K (K_14.1 × √(T / Target Reference))
                    </label>
                    <p className="text-slate-400 text-xs mt-2">
                      Weights are auto-normalized to sum to 1. Standings: Classic 14.1 = MP → 14.1 PERF → Point Diff → GD → HS; Point Differential 14.1 = MP → Point Diff → 14.1 PERF → GD → HS.
                    </p>
                  </div>
                )}

                {/* Tournament Settings */}
                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div>
                    <h3 className="text-white font-bold mb-3">Tournament Settings</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="text-white block mb-1 text-sm">Total Rounds</label>
                        <input
                          type="number"
                          value={config.default_rounds}
                          onChange={e => setConfig({ ...config, default_rounds: parseInt(e.target.value) || 1 })}
                          className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="text-white block mb-1 text-sm">Max Racks per Match</label>
                        <input
                          type="number"
                          value={config.max_games}
                          onChange={e => setConfig({ ...config, max_games: parseInt(e.target.value) || 1 })}
                          className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-white font-bold mb-3">GBR Settings</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="text-white block mb-1 text-sm">d-value (GBR spread)</label>
                        <input
                          type="number"
                          value={config.d}
                          onChange={e => setConfig({ ...config, d: parseInt(e.target.value) || 1 })}
                          className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="text-white block mb-1 text-sm">k-factor Match (k_m)</label>
                        <input
                          type="number"
                          value={config.k_m}
                          onChange={e => setConfig({ ...config, k_m: parseInt(e.target.value) || 1 })}
                          className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="text-white block mb-1 text-sm">k-factor Rack (k_r)</label>
                        <input
                          type="number"
                          value={config.k_r}
                          onChange={e => setConfig({ ...config, k_r: parseInt(e.target.value) || 1 })}
                          className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Prestige Score Settings */}
                <div className="mb-6 bg-slate-700 p-4 rounded-lg">
                  <div className="flex items-center gap-3 mb-4">
                    <input
                      type="checkbox"
                      id="use_rp_create"
                      checked={config.use_rp}
                      onChange={e => setConfig({ ...config, use_rp: e.target.checked })}
                      className="w-5 h-5"
                    />
                    <label htmlFor="use_rp_create" className="text-white font-bold text-lg">
                      Enable Prestige Score
                    </label>
                  </div>
                  
                  {config.use_rp && (
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-white block mb-1 text-sm">Prestige per Round</label>
                        <input
                          type="number"
                          value={config.rp_per_round}
                          onChange={e => setConfig({ ...config, rp_per_round: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-2 bg-slate-600 text-white rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="text-white block mb-1 text-sm">Prestige per Match Point</label>
                        <input
                          type="number"
                          value={config.rp_per_mp}
                          onChange={e => setConfig({ ...config, rp_per_mp: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-2 bg-slate-600 text-white rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="text-white block mb-1 text-sm">Prestige per GBR Gain (Multiplier)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={config.rp_elo_multiplier}
                          onChange={e => setConfig({ ...config, rp_elo_multiplier: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-2 bg-slate-600 text-white rounded-lg"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Rank Settings */}
                <div className="mb-6 bg-slate-700 p-4 rounded-lg">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="use_rank_create"
                      checked={config.use_rank}
                      onChange={e => setConfig({ ...config, use_rank: e.target.checked })}
                      className="w-5 h-5"
                    />
                    <label htmlFor="use_rank_create" className="text-white font-bold text-lg">
                      Enable Event Score
                    </label>
                  </div>
                  <p className="text-sm text-gray-400 mt-2">
                    Performance-based score (0-100 scale) shown in Final Table only. Weighs match points (70%), rack differential (20%), and performance (10%), adjusted for field strength.
                  </p>
                </div>

                {/* Ranking System */}
                <div className="bg-slate-700 p-4 rounded-lg border border-slate-600">
                  <label className="text-white block mb-2 font-semibold">Ranking System:</label>
                  <select
                    value={config.ranking_system}
                    onChange={e => setConfig({ ...config, ranking_system: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-600 text-white rounded-lg"
                  >
                    {config.format === 'straight_pool_14_1' ? (
                      <>
                        <option value="classic">Classic 14.1 (MP → 14.1 PERF → Point Diff)</option>
                        <option value="racks">Point Differential 14.1 (MP → Point Diff → 14.1 PERF)</option>
                      </>
                    ) : (
                      <>
                        <option value="classic">Classic (MP → Performance → ID)</option>
                        <option value="racks">Rack Differential (MP → Rack Diff → Performance)</option>
                      </>
                    )}
                  </select>
                  <p className="text-sm text-gray-400 mt-2">
                    {config.format === 'straight_pool_14_1'
                      ? (config.ranking_system === 'classic'
                          ? 'Players ranked by: 1st Match Points, 2nd 14.1 PERF, 3rd Point Diff, then GD, HS.'
                          : 'Players ranked by: 1st Match Points, 2nd Point Diff (P+ − P−), 3rd 14.1 PERF, then GD, HS.')
                      : (config.ranking_system === 'classic' 
                          ? 'Players ranked by: 1st Match Points, 2nd Avg Performance, 3rd Player ID.'
                          : 'Players ranked by: 1st Match Points, 2nd Rack Differential (racks won - racks lost), 3rd Avg Performance. Fairer for late-joining players.')}
                  </p>
                  {config.format === 'straight_pool_14_1' && (
                    <p className="text-xs text-amber-200 mt-2">
                      14.1 PERF is opponent-adjusted performance. Point Diff, GD, HGD, and HS show the raw 14.1 match quality.
                    </p>
                  )}
                </div>

                {/* Create Tournament Button */}
                <button
                  onClick={() => createTournamentConfig(tournamentTitle, config)}
                  className="w-full px-6 py-4 bg-blue-600 text-white rounded-lg font-bold text-lg hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                  <Play className="w-6 h-6" />
                  Create Tournament & Continue to Players
                </button>
              </div>
            ) : (
              /* TOURNAMENT DETAILS (READ-ONLY) */
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <h2 className="text-2xl font-bold text-white mb-6">{tournamentConfig.title}</h2>
                
                {tournamentConfig.format === 'straight_pool_14_1' ? (
                  (() => {
                    const tsp = { ...STRAIGHT_POOL_DEFAULTS, ...(tournamentConfig.straightPool || {}) };
                    const w = normalizeWeights(tsp);
                    const wp = (x) => Math.round(x * 100);
                    return (
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <h3 className="text-amber-300 font-bold mb-3 text-lg">14.1 Tournament Settings</h3>
                          <div className="space-y-2 text-slate-300">
                            <div className="flex justify-between"><span>Format:</span><span className="text-amber-200 font-semibold text-right">Straight Pool 14.1 — GBR_14.1 Experimental</span></div>
                            <div className="flex justify-between"><span>Total Rounds:</span><span className="text-white font-semibold">{tournamentConfig.default_rounds}</span></div>
                            <div className="flex justify-between"><span>R1 Target:</span><span className="text-white font-semibold">{tsp.startTarget}</span></div>
                            <div className="flex justify-between"><span>Tiering Starts Round:</span><span className="text-white font-semibold">{tsp.tieringStartsRound}</span></div>
                            <div className="flex justify-between"><span>Tier Targets:</span><span className="text-white font-semibold">{(tsp.tierTargets || []).join(' / ')}</span></div>
                            <div className="flex justify-between"><span>Ranking Mode:</span><span className="text-white font-semibold">{tournamentConfig.ranking_system === 'racks' ? 'Point Differential 14.1' : 'Classic 14.1'}</span></div>
                            <div className="flex justify-between"><span>Prestige Score:</span><span className="text-white font-semibold">{tournamentConfig.use_rp ? '✓ Enabled' : '✗ Disabled'}</span></div>
                            <div className="flex justify-between"><span>Event Score:</span><span className="text-white font-semibold">{tournamentConfig.use_rank ? '✓ Enabled' : '✗ Disabled'}</span></div>
                          </div>
                        </div>
                        <div>
                          <h3 className="text-white font-bold mb-3 text-lg">GBR_14.1 Parameters</h3>
                          <div className="space-y-2 text-slate-300">
                            <div className="flex justify-between"><span>Weights (Margin / GD / HS):</span><span className="text-white font-semibold">{wp(w.marginWeight)} / {wp(w.bpiWeight)} / {wp(w.highRunWeight)}</span></div>
                            <div className="flex justify-between"><span>K_match:</span><span className="text-white font-semibold">{tournamentConfig.k_m}</span></div>
                            <div className="flex justify-between"><span>K_14.1:</span><span className="text-white font-semibold">{tsp.k_14_1}</span></div>
                            <div className="flex justify-between"><span>Target Reference:</span><span className="text-white font-semibold">{tsp.targetReference}</span></div>
                            <div className="flex justify-between"><span>Target-scaled K:</span><span className="text-white font-semibold">{tsp.useTargetScaledK !== false ? '✓ On' : '✗ Off'}</span></div>
                            <div className="flex justify-between"><span>d-value:</span><span className="text-white font-semibold">{tournamentConfig.d}</span></div>
                          </div>
                          <p className="text-xs text-amber-200 mt-3">14.1 PERF is opponent-adjusted performance. Point Diff, GD, HGD, and HS show the raw 14.1 match quality.</p>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-white font-bold mb-3 text-lg">Tournament Settings</h3>
                    <div className="space-y-2 text-slate-300">
                      <div className="flex justify-between">
                        <span>Total Rounds:</span>
                        <span className="text-white font-semibold">{tournamentConfig.default_rounds}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Max Racks per Match:</span>
                        <span className="text-white font-semibold">{tournamentConfig.max_games}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Prestige Score:</span>
                        <span className="text-white font-semibold">{tournamentConfig.use_rp ? '✓ Enabled' : '✗ Disabled'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Event Score:</span>
                        <span className="text-white font-semibold">{tournamentConfig.use_rank ? '✓ Enabled' : '✗ Disabled'}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-white font-bold mb-3 text-lg">GBR Settings</h3>
                    <div className="space-y-2 text-slate-300">
                      <div className="flex justify-between">
                        <span>d-value:</span>
                        <span className="text-white font-semibold">{tournamentConfig.d}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>k-factor Match (k_m):</span>
                        <span className="text-white font-semibold">{tournamentConfig.k_m}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>k-factor Rack (k_r):</span>
                        <span className="text-white font-semibold">{tournamentConfig.k_r}</span>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {tournamentConfig.use_rp && (
                  <div className="mt-6 pt-6 border-t border-slate-700">
                    <h3 className="text-white font-bold mb-3 text-lg">Prestige Score Details</h3>
                    <div className="grid grid-cols-3 gap-4 text-slate-300">
                      <div className="flex justify-between">
                        <span>Per Round:</span>
                        <span className="text-white font-semibold">{tournamentConfig.rp_per_round}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Per Match Point:</span>
                        <span className="text-white font-semibold">{tournamentConfig.rp_per_mp}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>GBR Multiplier:</span>
                        <span className="text-white font-semibold">{tournamentConfig.rp_elo_multiplier}</span>
                      </div>
                    </div>
                  </div>
                )}

                {!tournament && (
                  <div className="mt-6 p-4 bg-blue-900 border border-blue-700 rounded-lg">
                    <p className="text-blue-200 text-sm">
                      Tournament configuration complete! Go to the <strong>Players</strong> tab to add participants and start the tournament.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* PLAYERS VIEW */}
        {view === 'players' && (
          <div className="space-y-6">
            {!tournament && (
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-1">Ready to Start Tournament?</h2>
                    <p className="text-slate-400">{players.length} players registered</p>
                  </div>
                  {players.length >= 2 ? (
                    <button
                      onClick={startTournament}
                      className="px-8 py-4 bg-blue-600 text-white rounded-lg font-bold text-xl hover:bg-blue-700 flex items-center gap-3"
                    >
                      <Play className="w-6 h-6" />
                      Start Tournament
                    </button>
                  ) : (
                    <div className="text-slate-400 text-sm">Add at least 2 players to start</div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h2 className="text-xl font-bold text-white mb-4">Add Player</h2>
              {clubDatabase.length > 0 && (
                <div className="mb-4">
                  <label className="text-white block mb-2">Select from Club Database:</label>
                  <select
                    onChange={e => {
                      const selectedPlayer = clubDatabase.find(p => p.id === parseInt(e.target.value));
                      if (selectedPlayer) {
                        setPlayers([...players, {
                          id: Date.now(),
                          name: selectedPlayer.name,
                          elo: selectedPlayer.elo
                        }]);
                        e.target.value = ''; // Reset dropdown
                      }
                    }}
                    className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg"
                  >
                    <option value="">-- Select a player --</option>
                    {clubDatabase
                      .filter(dbPlayer => {
                        // Hide players already in the players list
                        return !players.some(p => p.name.toLowerCase() === dbPlayer.name.toLowerCase());
                      })
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} (GBR: {p.elo})
                        </option>
                      ))}
                  </select>
                  {clubDatabase.length > 0 && clubDatabase.filter(dbPlayer => 
                    !players.some(p => p.name.toLowerCase() === dbPlayer.name.toLowerCase())
                  ).length === 0 && (
                    <p className="text-yellow-400 text-sm mt-2">All database players already registered</p>
                  )}
                </div>
              )}
              <div className="mb-2">
                <label className="text-white block mb-2">Or add new player manually:</label>
              </div>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Name"
                  value={newPlayer.name}
                  onChange={e => setNewPlayer({ ...newPlayer, name: e.target.value })}
                  className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg"
                />
                <input
                  type="number"
                  placeholder="GBR"
                  value={newPlayer.elo}
                  onChange={e => setNewPlayer({ ...newPlayer, elo: e.target.value })}
                  className="w-24 px-4 py-2 bg-slate-700 text-white rounded-lg"
                />
                <button
                  onClick={() => {
                    if (newPlayer.name.trim()) {
                      // Check if player is already registered
                      const isDuplicate = players.some(p => p.name.toLowerCase() === newPlayer.name.trim().toLowerCase());
                      if (isDuplicate) {
                        setErrorMessage(`${newPlayer.name} is already registered!`);
                        setTimeout(() => setErrorMessage(''), 3000);
                        return;
                      }
                      
                      setPlayers([...players, {
                        id: Date.now(),
                        name: newPlayer.name,
                        elo: parseInt(newPlayer.elo) || 1500
                      }]);
                      setNewPlayer({ name: '', elo: 1500 });
                    }
                  }}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h2 className="text-xl font-bold text-white mb-4">Players ({players.length})</h2>
              <div className="space-y-2 mb-6">
                {players.map(p => (
                  <div key={p.id} className="flex justify-between bg-slate-700 p-4 rounded-lg">
                    {editingPlayer?.id === p.id ? (
                      <>
                        <input
                          type="text"
                          value={editingPlayer.name}
                          onChange={e => setEditingPlayer({ ...editingPlayer, name: e.target.value })}
                          className="flex-1 px-3 py-1 bg-slate-600 text-white rounded mr-2"
                        />
                        <input
                          type="number"
                          value={editingPlayer.elo}
                          onChange={e => setEditingPlayer({ ...editingPlayer, elo: parseInt(e.target.value) })}
                          className="w-24 px-3 py-1 bg-slate-600 text-white rounded mr-2"
                        />
                        <button
                          onClick={() => {
                            setPlayers(players.map(x => x.id === editingPlayer.id ? editingPlayer : x));
                            setEditingPlayer(null);
                          }}
                          className="px-4 py-1 bg-blue-600 text-white rounded"
                        >
                          Save
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-white">{p.name}</span>
                        <div className="flex gap-4">
                          <span className="text-yellow-400">GBR: {p.elo}</span>
                          <button onClick={() => setEditingPlayer(p)} className="text-blue-400">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => setPlayers(players.filter(x => x.id !== p.id))} className="text-red-400">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {tournament && tournament.players.filter(p => p.removed).length > 0 && (
                <>
                  <div className="border-t border-slate-600 my-6"></div>
                  <h2 className="text-xl font-bold text-red-400 mb-4">
                    Removed Players ({tournament.players.filter(p => p.removed).length})
                  </h2>
                  <div className="space-y-2 mb-6">
                    {tournament.players
                      .filter(p => p.removed)
                      .map(p => (
                        <div key={p.id} className="flex justify-between bg-red-900 bg-opacity-30 p-4 rounded-lg border border-red-700">
                          <span className="text-red-200">{p.name}</span>
                          <div className="flex gap-4 items-center">
                            <span className="text-red-300">GBR: {Math.round(p.elo)}</span>
                            <button
                              onClick={() => restorePlayer(p.id)}
                              className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              Restore
                            </button>
                            <button
                              onClick={() => deletePlayerFromTournament(p.id)}
                              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1"
                              title="Permanently delete from tournament"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {view === 'round' && tournament && (
          <div className="space-y-6">
            {tournamentConfig?.title && (
              <div className="bg-gradient-to-r from-slate-800 to-blue-900 rounded-lg p-4 border border-blue-700">
                {editingTitle ? (
                  <div className="flex gap-3 items-center justify-center">
                    <input
                      type="text"
                      value={tempTitle}
                      onChange={(e) => setTempTitle(e.target.value)}
                      className="px-3 py-2 border rounded-lg bg-slate-700 text-white border-slate-600 flex-1 max-w-md"
                      placeholder="Tournament Title"
                      autoFocus
                    />
                    <button
                      onClick={saveTitle}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEditTitle}
                      className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3 items-center justify-center">
                    <h2 className="text-2xl font-bold text-white">{tournamentConfig.title}</h2>
                    <button
                      onClick={startEditingTitle}
                      className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      title="Edit tournament title"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-white">Round {viewingRound}</h2>
                <div className="flex gap-3">
                  {viewingRound === currentRound && (
                    <>
                      <button
                        onClick={() => setShowAddModal(true)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg"
                      >
                        <UserPlus className="w-4 h-4 inline mr-2" />
                        Add Player
                      </button>
                      <button
                        onClick={() => setShowRemovePlayerModal(true)}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                      >
                        <UserMinus className="w-4 h-4 inline mr-2" />
                        Remove Players
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setRegenerateRoundNum(viewingRound);
                      setShowRegenerateConfirm(true);
                    }}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-2"
                    title="Regenerate pairings based on current standings from previous rounds"
                  >
                    <RotateCw className="w-4 h-4" />
                    Regenerate Pairings
                  </button>
                  <button
                    onClick={() => openManualPairingEditor(viewingRound)}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-2"
                    title="Emergency: Directly edit pairings for this round"
                  >
                    <Edit className="w-4 h-4" />
                    Manual Pairings
                  </button>
                  <button
                    onClick={() => setShowTableConfig(!showTableConfig)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                    title="Configure table numbers"
                  >
                    <Table className="w-4 h-4" />
                    Table Numbers
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {(allRounds[viewingRound] || []).map(m => {
                  const p1Expected = m.bye ? 1 : expectedScore(m.p1.elo, m.p2.elo, config.d);
                  const p2Expected = m.bye ? 0 : expectedScore(m.p2.elo, m.p1.elo, config.d);

                  return (
                    <div
                      key={m.id}
                      className={`bg-slate-700 p-4 rounded-lg border-2 flex flex-col ${m.done ? 'border-green-600' : m.cancelled ? 'border-red-600' : 'border-slate-600'}`}
                    >
                      <div className="flex justify-between mb-3">
                        <div className="flex gap-2 items-center">
                          <span className="text-slate-400">Table</span>
                          <input
                            type="text"
                            value={m.tbl}
                            onChange={e => setAllRounds({
                              ...allRounds,
                              [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, tbl: e.target.value } : x)
                            })}
                            className="w-24 px-2 py-1 bg-slate-600 text-white rounded text-center"
                            disabled={m.cancelled}
                          />
                        </div>
                        {m.done && <div className="text-green-400 font-bold">✓</div>}
                        {m.cancelled && <div className="text-red-400 font-bold">✗ Cancelled</div>}
                      </div>
                      <div className="grid grid-cols-3 gap-4 items-center">
                        <div className="text-center">
                          <div className="text-white font-bold">{m.p1.name}</div>
                          <div className="text-yellow-400 text-sm">GBR: {Math.round(m.p1.elo)}</div>
                          {!m.bye && <div className="text-green-400 text-xs mt-1">Win: {Math.round(p1Expected * 100)}%</div>}
                        </div>
                        <div className="text-center">
                          {m.format === 'straight_pool_14_1' && !m.bye ? (
                            <>
                              <div className="text-blue-300 text-sm mb-2">Target: race to {m.target}</div>
                              <div className="flex justify-center items-center gap-2">
                                {!m.done && !m.cancelled && (
                                  <input
                                    type="number"
                                    min="0"
                                    value={m.p1Points || 0}
                                    onChange={e => {
                                      const v = parseInt(e.target.value) || 0;
                                      setAllRounds({
                                        ...allRounds,
                                        [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, p1Points: v } : x)
                                      });
                                    }}
                                    className="w-16 px-2 py-2 bg-slate-600 text-white rounded text-center"
                                    title="Player A points"
                                  />
                                )}
                                {m.done && <div className="text-2xl font-bold text-white">{m.p1Points}</div>}
                                <div className="text-slate-400 font-bold text-xl">:</div>
                                {!m.done && !m.cancelled && (
                                  <input
                                    type="number"
                                    min="0"
                                    value={m.p2Points || 0}
                                    onChange={e => {
                                      const v = parseInt(e.target.value) || 0;
                                      setAllRounds({
                                        ...allRounds,
                                        [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, p2Points: v } : x)
                                      });
                                    }}
                                    className="w-16 px-2 py-2 bg-slate-600 text-white rounded text-center"
                                    title="Player B points"
                                  />
                                )}
                                {m.done && <div className="text-2xl font-bold text-white">{m.p2Points}</div>}
                              </div>
                              <div className="text-slate-400 text-xs mt-1">Points</div>
                            </>
                          ) : (
                          <>
                          <div className="text-slate-300 text-sm mb-2">{config.max_games} racks</div>
                          <div className="flex justify-center items-center gap-2">
                            {!m.done && !m.bye && !m.cancelled && (
                              <input
                                type="number"
                                min="0"
                                max={config.max_games}
                                value={m.r1}
                                onChange={e => {
                                  const newR1 = parseInt(e.target.value) || 0;
                                  // Prevent sum from exceeding max_games
                                  if (newR1 + m.r2 <= config.max_games) {
                                    setAllRounds({
                                      ...allRounds,
                                      [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, r1: newR1 } : x)
                                    });
                                  }
                                }}
                                className="w-16 px-2 py-2 bg-slate-600 text-white rounded text-center"
                              />
                            )}
                            {m.done && <div className="text-2xl font-bold text-white">{m.r1}</div>}
                            <div className="text-slate-400 font-bold text-xl">:</div>
                            {!m.done && !m.bye && !m.cancelled && (
                              <input
                                type="number"
                                min="0"
                                max={config.max_games}
                                value={m.r2}
                                onChange={e => {
                                  const newR2 = parseInt(e.target.value) || 0;
                                  // Prevent sum from exceeding max_games
                                  if (m.r1 + newR2 <= config.max_games) {
                                    setAllRounds({
                                      ...allRounds,
                                      [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, r2: newR2 } : x)
                                    });
                                  }
                                }}
                                className="w-16 px-2 py-2 bg-slate-600 text-white rounded text-center"
                              />
                            )}
                            {m.done && <div className="text-2xl font-bold text-white">{m.r2}</div>}
                          </div>
                          </>
                          )}
                        </div>
                        <div className="text-center">
                          <div className="text-white font-bold">{m.p2.name}</div>
                          <div className="text-yellow-400 text-sm">GBR: {Math.round(m.p2.elo)}</div>
                          {!m.bye && <div className="text-green-400 text-xs mt-1">Win: {Math.round(p2Expected * 100)}%</div>}
                        </div>
                      </div>
                      {m.format === 'straight_pool_14_1' && !m.bye && (
                        <div className="grid grid-cols-3 gap-2 items-end mt-3 text-center">
                          <div>
                            <label className="text-slate-400 text-xs block mb-1">High Run (A)</label>
                            {!m.done && !m.cancelled ? (
                              <input type="number" min="0" value={m.p1HighRun || 0}
                                onChange={e => { const v = parseInt(e.target.value) || 0; setAllRounds({ ...allRounds, [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, p1HighRun: v } : x) }); }}
                                className="w-full px-2 py-1 bg-slate-600 text-white rounded text-center" />
                            ) : <div className="text-white font-semibold">{m.p1HighRun}</div>}
                          </div>
                          <div>
                            <label className="text-slate-400 text-xs block mb-1">Innings</label>
                            {!m.done && !m.cancelled ? (
                              <input type="number" min="1" value={m.innings || 0}
                                onChange={e => { const v = parseInt(e.target.value) || 0; setAllRounds({ ...allRounds, [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, innings: v } : x) }); }}
                                className="w-full px-2 py-1 bg-slate-600 text-white rounded text-center" />
                            ) : <div className="text-white font-semibold">{m.innings}</div>}
                          </div>
                          <div>
                            <label className="text-slate-400 text-xs block mb-1">High Run (B)</label>
                            {!m.done && !m.cancelled ? (
                              <input type="number" min="0" value={m.p2HighRun || 0}
                                onChange={e => { const v = parseInt(e.target.value) || 0; setAllRounds({ ...allRounds, [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, p2HighRun: v } : x) }); }}
                                className="w-full px-2 py-1 bg-slate-600 text-white rounded text-center" />
                            ) : <div className="text-white font-semibold">{m.p2HighRun}</div>}
                          </div>
                        </div>
                      )}
                      <div className="mt-auto">
                        {!m.done && !m.bye && !m.cancelled && (
                          <div className="flex gap-3 mt-4">
                            <button
                              onClick={() => completeMatch(viewingRound, m.id)}
                              className={`flex-1 px-4 py-2 text-white rounded-lg font-semibold ${
                                (m.format === 'straight_pool_14_1' ? (m.p1Points > 0 || m.p2Points > 0) : (m.r1 > 0 || m.r2 > 0))
                                  ? 'bg-green-600 hover:bg-green-700'
                                  : 'bg-blue-600 hover:bg-blue-700'
                              }`}
                            >
                              {(m.format === 'straight_pool_14_1' ? (m.p1Points > 0 || m.p2Points > 0) : (m.r1 > 0 || m.r2 > 0)) ? '✓ Complete' : 'Complete'}
                            </button>
                            <button
                              onClick={() => {
                                setAllRounds({
                                  ...allRounds,
                                  [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, cancelled: true } : x)
                                });
                              }}
                              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                        {m.done && m.bye && (
                          <button
                            onClick={() => {
                              setAllRounds({
                                ...allRounds,
                                [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, cancelled: true, done: false } : x)
                              });
                            }}
                            className="w-full mt-4 px-4 py-2 bg-red-600 text-white rounded-lg"
                          >
                            Cancel FREILOS
                          </button>
                        )}
                        {m.done && !m.bye && (
                          <button
                            onClick={() => {
                              setAllRounds({
                                ...allRounds,
                                [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, done: false } : x)
                              });
                            }}
                            className="w-full mt-4 px-4 py-2 bg-amber-600 text-white rounded-lg"
                          >
                            Edit Score
                          </button>
                        )}
                        {m.cancelled && (
                          <button
                            onClick={() => {
                              setAllRounds({
                                ...allRounds,
                                [viewingRound]: allRounds[viewingRound].map(x => x.id === m.id ? { ...x, cancelled: false, r1: 0, r2: 0 } : x)
                              });
                            }}
                            className="w-full mt-4 px-4 py-2 bg-amber-600 text-white rounded-lg"
                          >
                            Uncancel & Enter Score
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {viewingRound === currentRound && (
                <button
                  onClick={nextRound}
                  className="w-full mt-6 px-6 py-3 bg-blue-600 text-white rounded-lg font-bold text-lg"
                >
                  {currentRound >= tournament.totalRounds ? 'View Final Results' : `Start Round ${currentRound + 1}`}
                </button>
              )}
              
              {/* Emergency Undo Advance Button - only visible when snapshot exists */}
              {preAdvanceSnapshot && viewingRound === currentRound && (
                <button
                  onClick={() => setShowUndoAdvanceConfirm(true)}
                  className="w-full mt-3 px-4 py-2 bg-red-900 text-red-200 rounded-lg border border-red-700 hover:bg-red-800 text-sm font-semibold"
                >
                  ⚠️ Cancel Current Round (Undo Advance)
                </button>
              )}
            </div>

            {/* Pending Players - waiting for next round */}
            {viewingRound === currentRound && pendingPlayers.length > 0 && (
              <div className="bg-amber-900 rounded-lg p-6 border border-amber-700">
                <h3 className="text-lg font-bold text-white mb-3">
                  ⏳ Pending Players (Will be seeded into Round {currentRound + 1})
                </h3>
                <p className="text-amber-200 text-sm mb-4">
                  These players will be paired in the next round based on their GBR compared to existing players' performance.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {pendingPlayers.map(p => (
                    <div key={p.id} className="bg-amber-800 p-3 rounded-lg border border-amber-600">
                      <div className="text-white font-bold">{p.name}</div>
                      <div className="text-amber-200 text-sm">GBR: {p.elo}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h3 className="text-lg font-bold text-white mb-4">Ranking after Round {viewingRound}</h3>
              <div className="space-y-2">
                {(() => {
                  const standings = {};

                  // Only include players who had joined by this round
                  tournament.players
                    .filter(p => (p.joinedRound || 1) <= viewingRound)
                    .forEach(p => {
                    const startElo = players.find(pl => pl.id === p.id)?.elo || p.elo;
                    standings[p.id] = {
                      name: p.name,
                      mp: 0,
                      perf: 0,
                      elo: startElo,
                      prevElo: startElo,
                      games: 0,
                      perfCount: 0,
                      racksWon: 0,   // Track racks won
                      racksLost: 0   // Track racks lost
                    };
                  });

                  for (let r = 1; r <= viewingRound; r++) {
                    if (r === viewingRound) {
                      Object.keys(standings).forEach(id => {
                        standings[id].prevElo = standings[id].elo;
                      });
                    }

                    (allRounds[r] || []).forEach(m => {
                      if (m.done && !m.cancelled) {
                        const p1EloBeforeMatch = standings[m.p1.id]?.elo || m.p1.elo;
                        const p2EloBeforeMatch = standings[m.p2.id]?.elo || m.p2.elo;

                        if (standings[m.p1.id]) {
                          const mps = m.bye ? 1 : (m.r1 > m.r2 ? 1 : m.r1 === m.r2 ? 0.5 : 0); // bye = +1 MP (whitepaper §9.3)
                          standings[m.p1.id].mp += mps;
                          standings[m.p1.id].games++;

                          if (!m.bye) {
                            standings[m.p1.id].racksWon += m.r1;   // Racks won by player 1
                            standings[m.p1.id].racksLost += m.r2;  // Racks won by opponent
                            const eloChange = calcEloChange(p1EloBeforeMatch, p2EloBeforeMatch, m.r1, m.r2);
                            const perfElo = calcPerformanceElo(p2EloBeforeMatch, m.r1, m.r2);
                            standings[m.p1.id].elo += eloChange;
                            standings[m.p1.id].perf += perfElo;
                            standings[m.p1.id].perfCount++;
                          }
                        }

                        if (m.p2.id !== 'bye' && standings[m.p2.id]) {
                          const mps = m.r2 > m.r1 ? 1 : m.r2 === m.r1 ? 0.5 : 0;
                          standings[m.p2.id].mp += mps;
                          standings[m.p2.id].games++;
                          standings[m.p2.id].racksWon += m.r2;   // Racks won by player 2
                          standings[m.p2.id].racksLost += m.r1;  // Racks won by opponent

                          const eloChange = calcEloChange(p1EloBeforeMatch, p2EloBeforeMatch, m.r1, m.r2);
                          const perfElo = calcPerformanceElo(p1EloBeforeMatch, m.r2, m.r1);
                          standings[m.p2.id].elo -= eloChange;
                          standings[m.p2.id].perf += perfElo;
                          standings[m.p2.id].perfCount++;
                        }
                      }
                    });
                  }

                  const eloBeforeRound = {};
                  tournament.players
                    .filter(p => (p.joinedRound || 1) <= viewingRound)
                    .forEach(p => {
                    const startElo = players.find(pl => pl.id === p.id)?.elo || p.elo;
                    let elo = startElo;

                    for (let r = 1; r < viewingRound; r++) {
                      (allRounds[r] || []).forEach(m => {
                        if (m.done && !m.cancelled && !m.bye) {
                          if (m.p1.id === p.id) {
                            const eloChange = calcEloChange(elo, m.p2.elo, m.r1, m.r2);
                            elo += eloChange;
                          } else if (m.p2.id === p.id) {
                            const eloChange = calcEloChange(m.p1.elo, elo, m.r1, m.r2);
                            elo -= eloChange;
                          }
                        }
                      });
                    }
                    eloBeforeRound[p.id] = elo;
                  });

                  const roundPerf = {};
                  (allRounds[viewingRound] || []).forEach(m => {
                    if (m.done && !m.cancelled) {
                      if (!m.bye) {
                        const p2EloAtMatch = eloBeforeRound[m.p2.id] || m.p2.elo;
                        roundPerf[m.p1.id] = calcPerformanceElo(p2EloAtMatch, m.r1, m.r2);

                        const p1EloAtMatch = eloBeforeRound[m.p1.id] || m.p1.elo;
                        roundPerf[m.p2.id] = calcPerformanceElo(p1EloAtMatch, m.r2, m.r1);
                      } else {
                        roundPerf[m.p1.id] = 0;
                      }
                    }
                  });

                  const avgPerf = {};
                  Object.entries(standings).forEach(([id, s]) => {
                    avgPerf[id] = s.perfCount > 0 ? s.perf / s.perfCount : 0;
                  });

                  // Calculate RP for this round only
                  const rpThisRound = {};
                  if (config.use_rp) {
                    (allRounds[viewingRound] || []).forEach(m => {
                      if (m.done && !m.cancelled) {
                        if (standings[m.p1.id]) {
                          const mp1 = m.bye ? 1 : (m.r1 > m.r2 ? 1 : m.r1 === m.r2 ? 0.5 : 0); // bye = +1 MP (whitepaper §9.3)
                          const eloChange1 = !m.bye ? (standings[m.p1.id].elo - standings[m.p1.id].prevElo) : 0;
                          rpThisRound[m.p1.id] = calcRoundRP(mp1, eloChange1);
                        }
                        if (m.p2.id !== 'bye' && standings[m.p2.id]) {
                          const mp2 = m.r2 > m.r1 ? 1 : m.r2 === m.r1 ? 0.5 : 0;
                          const eloChange2 = standings[m.p2.id].elo - standings[m.p2.id].prevElo;
                          rpThisRound[m.p2.id] = calcRoundRP(mp2, eloChange2);
                        }
                      }
                    });
                  }

                  return Object.entries(standings)
                    .map(([id, s]) => ({
                      ...s,
                      id: parseInt(id),
                      avgPerf: s.perfCount > 0 ? s.perf / s.perfCount : 0
                    }))
                    .sort(compareRankings)
                    .map((s, i) => {
                      const id = s.id.toString();
                      const diff = s.elo - s.prevElo;
                      const diffRounded = diff >= 0 ? Math.ceil(diff) : Math.floor(diff);
                      const thisRoundPerf = roundPerf[id] || 0;
                      const avgPerfValue = s.avgPerf;
                      const rpThisRoundValue = rpThisRound[id] || 0;
                      // v1.93: this-round 14.1 stats (points, GD, HS) from this player's match
                      let spRound = null;
                      if (isStraightPool()) {
                        const rm = (allRounds[viewingRound] || []).find(m => !m.bye && m.done && !m.cancelled && (m.p1.id === s.id || m.p2.id === s.id));
                        if (rm) {
                          const isP1 = rm.p1.id === s.id;
                          const pts = isP1 ? (rm.p1Points || 0) : (rm.p2Points || 0);
                          const opp = isP1 ? (rm.p2Points || 0) : (rm.p1Points || 0);
                          const hr = isP1 ? (rm.p1HighRun || 0) : (rm.p2HighRun || 0);
                          spRound = { pts, opp, gd: rm.innings > 0 ? pts / rm.innings : 0, hs: hr };
                        }
                      }
                      return (
                        <div key={id} className="bg-slate-700 p-3 rounded-lg">
                          <div className="flex justify-between items-center">
                            <div className="flex gap-3 items-center">
                              <span className="text-slate-400 font-bold">#{i + 1}</span>
                              <span className="text-white font-medium">{s.name}</span>
                            </div>
                            <div className="flex gap-4 text-sm">
                              {config.ranking_system === 'classic' && (
                                <div className="text-right">
                                  <div className="text-slate-400">Score</div>
                                  <div className="text-yellow-400 font-bold">{classicStandingScore(s.mp, avgPerfValue).toFixed(4)}</div>
                                </div>
                              )}
                              <div className="text-right">
                                <div className="text-slate-400">MPs</div>
                                <div className={`font-bold ${config.ranking_system === 'racks' ? 'text-yellow-400' : 'text-white'}`}>{s.mp}</div>
                              </div>
                              {config.ranking_system === 'racks' && !isStraightPool() && (
                                <div className="text-right">
                                  <div className="text-slate-400">Rack Diff</div>
                                  <div className="text-yellow-400 font-bold">{(s.racksWon || 0) - (s.racksLost || 0)}</div>
                                </div>
                              )}
                              {isStraightPool() && (
                                <>
                                  <div className="text-right">
                                    <div className="text-slate-400">P+ / P-</div>
                                    <div className="text-white font-bold">{spRound ? `${spRound.pts}/${spRound.opp}` : '—'}</div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-slate-400">Point Diff</div>
                                    <div className="text-yellow-400 font-bold">{spRound ? `${(spRound.pts - spRound.opp) >= 0 ? '+' : ''}${spRound.pts - spRound.opp}` : '—'}</div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-slate-400">GD (rnd)</div>
                                    <div className="text-white font-bold">{spRound ? spRound.gd.toFixed(2) : '—'}</div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-slate-400">HS (rnd)</div>
                                    <div className="text-white font-bold">{spRound ? spRound.hs : '—'}</div>
                                  </div>
                                </>
                              )}
                              <div className="text-right">
                                <div className="text-slate-400">{isStraightPool() ? 'Match PERF' : 'Round Perf'}</div>
                                <div className="text-white font-bold">{Math.round(thisRoundPerf)}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-slate-400">Avg Perf</div>
                                <div className="text-yellow-400 font-bold">{Math.round(avgPerfValue)}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-slate-400">GBR</div>
                                <div className="text-white font-bold">{Math.round(s.elo)}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-slate-400">Δ GBR</div>
                                <div className={`font-bold ${diffRounded > 0 ? 'text-green-400' : diffRounded < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                                  {diffRounded > 0 ? '+' : ''}{diffRounded}
                                </div>
                              </div>
                              {config.use_rp && (
                                <div className="text-right">
                                  <div className="text-slate-400">Round RP</div>
                                  <div className={`font-bold ${rpThisRoundValue > 0 ? 'text-green-400' : 'text-slate-400'}`}>
                                    {rpThisRoundValue > 0 ? '+' : ''}{Math.round(rpThisRoundValue)}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    });
                })()}
              </div>
            </div>
          </div>
        )}

        {view === 'results' && tournament && (
          <div className="space-y-6">
            {tournamentConfig?.title && (
              <div className="bg-gradient-to-r from-slate-800 to-blue-900 rounded-lg p-4 border border-blue-700">
                {editingTitle ? (
                  <div className="flex gap-3 items-center justify-center">
                    <input
                      type="text"
                      value={tempTitle}
                      onChange={(e) => setTempTitle(e.target.value)}
                      className="px-3 py-2 border rounded-lg bg-slate-700 text-white border-slate-600 flex-1 max-w-md"
                      placeholder="Tournament Title"
                      autoFocus
                    />
                    <button
                      onClick={saveTitle}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEditTitle}
                      className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3 items-center justify-center">
                    <h2 className="text-2xl font-bold text-white">{tournamentConfig.title}</h2>
                    <button
                      onClick={startEditingTitle}
                      className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      title="Edit tournament title"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
            
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-white">Final Ranking</h2>
              <div className="flex gap-3">
                {exportResultsURL && (
                  <a
                    href={exportResultsURL}
                    download={`${(tournamentConfig?.title || 'Tournament').replace(/[^a-z0-9]/gi, '_')}_Final_Results.csv`}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 no-underline"
                    title="Download final results table as CSV"
                  >
                    <Download className="w-4 h-4" />
                    Export Results CSV
                  </a>
                )}
                {exportELOsURL && (
                  <a
                    href={exportELOsURL}
                    download={`${(tournamentConfig?.title || 'Tournament').replace(/[^a-z0-9]/gi, '_')}_Updated_GBR_Database.csv`}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 no-underline"
                    title={clubDatabase && clubDatabase.length > 0 
                      ? "Export full club GBR database with updated ratings (only tournament participants updated)" 
                      : "Export updated GBR ratings for tournament participants"}
                  >
                    <Download className="w-4 h-4" />
                    {clubDatabase && clubDatabase.length > 0 ? 'Export Updated GBR Database' : 'Export Updated GBRs'}
                  </a>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {[...tournament.players]
                .map(p => {
                  const startElo = players.find(pl => pl.id === p.id)?.elo || p.elo;
                  return {
                    ...p,
                    startElo,
                    avgPerf: p.perfCount > 0 ? p.perf / p.perfCount : 0
                  };
                })
                .sort(compareRankings)
                .map((p, i) => {
                  const rankColor = i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-orange-400' : 'text-slate-400';
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
                  
                  return (
                    <div key={p.id} className="bg-slate-700 p-4 rounded-lg">
                      <div className="flex justify-between items-center">
                        <div className="flex gap-4 items-center">
                          <span className={`text-3xl font-bold ${rankColor}`}>
                            {medal} #{i + 1}
                          </span>
                          <div>
                            <div className="text-xl font-bold text-white">{p.name}</div>
                            <div className="text-slate-300 text-sm">
                              GBR: {Math.round(p.startElo)} → {Math.round(p.elo)} | {isStraightPool() ? '14.1 PERF' : 'Avg Perf'}: {Math.round(p.avgPerf)}
                            </div>
                            {isStraightPool() && (
                              <div className="text-slate-400 text-xs mt-1">
                                P+/P- {p.pointsFor || 0} / {p.pointsAgainst || 0} · GD {(p.inningsTotal > 0 ? (p.pointsFor / p.inningsTotal) : 0).toFixed(2)} · HGD {(p.hgd || 0).toFixed(2)} · HS {p.hs || 0}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 items-start">
                          {config.use_rp && (
                            <div className="text-right" style={{minWidth: '76px'}}>
                              <div className="text-2xl font-bold text-purple-400 leading-tight">{Math.round(p.rp || 0)}</div>
                              <div className="text-slate-400 text-xs whitespace-nowrap">Prestige</div>
                            </div>
                          )}
                          {config.use_rank && (
                            <div className="text-right" style={{minWidth: '76px'}}>
                              <div className="text-2xl font-bold text-cyan-400 leading-tight">{calcRank(p, tournament.players, tournament, clubDatabase)}</div>
                              <div className="text-slate-400 text-xs whitespace-nowrap">Event Score</div>
                            </div>
                          )}
                          <div className="text-right" style={{minWidth: '76px'}}>
                            <div className="text-2xl font-bold text-green-400 leading-tight">
                              {isStraightPool()
                                ? `${p.mp} MP`
                                : (config.ranking_system === 'classic' 
                                    ? classicStandingScore(p.mp, p.avgPerf).toFixed(4)
                                    : `${p.mp} MP`)}
                            </div>
                            <div className="text-slate-400 text-xs whitespace-nowrap">
                              {isStraightPool() ? 'Match Points' : (config.ranking_system === 'classic' ? 'Score' : 'Match Points')}
                            </div>
                          </div>
                          {isStraightPool() && (
                            <div className="text-right" style={{minWidth: '76px'}}>
                              <div className="text-2xl font-bold text-green-400 leading-tight">
                                {(() => {
                                  const pd = (p.pointsFor || 0) - (p.pointsAgainst || 0);
                                  return pd > 0 ? `+${pd}` : pd;
                                })()}
                              </div>
                              <div className="text-slate-400 text-xs whitespace-nowrap">Point Diff</div>
                            </div>
                          )}
                          {config.ranking_system === 'racks' && !isStraightPool() && (
                            <div className="text-right" style={{minWidth: '76px'}}>
                              <div className="text-2xl font-bold text-green-400 leading-tight">
                                {(() => {
                                  const rd = (p.racksWon || 0) - (p.racksLost || 0);
                                  return rd > 0 ? `+${rd}` : rd === 0 ? '0' : rd;
                                })()}
                              </div>
                              <div className="text-slate-400 text-xs whitespace-nowrap">Rack Diff</div>
                            </div>
                          )}
                          {/* Round-by-round columns */}
                          {(() => {
                            const roundColumns = [];
                            for (let r = 1; r <= tournament.totalRounds; r++) {
                              const matches = allRounds[r] || [];
                              const match = matches.find(m => m.p1.id === p.id || m.p2.id === p.id);
                              let points = '-';
                              
                              if (match && match.done && !match.cancelled) {
                                if (match.p1.id === p.id) {
                                  points = match.r1 > match.r2 ? '1' : match.r1 === match.r2 ? '0.5' : '0';
                                } else if (match.p2.id === p.id) {
                                  points = match.r2 > match.r1 ? '1' : match.r2 === match.r1 ? '0.5' : '0';
                                }
                              } else if ((p.joinedRound || 1) > r) {
                                points = '-';
                              }
                              
                              roundColumns.push(
                                <div key={r} className="text-right" style={{minWidth: '45px'}}>
                                  <div className="text-2xl font-bold text-slate-300 leading-tight">{points}</div>
                                  <div className="text-slate-400 text-xs whitespace-nowrap">Round {r}</div>
                                </div>
                              );
                            }
                            return roundColumns;
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
          </div>
        )}

        {view === 'allRounds' && tournament && (
          <div className="space-y-8">
            {tournamentConfig?.title && (
              <div className="bg-gradient-to-r from-slate-800 to-blue-900 rounded-lg p-4 border border-blue-700">
                {editingTitle ? (
                  <div className="flex gap-3 items-center justify-center">
                    <input
                      type="text"
                      value={tempTitle}
                      onChange={(e) => setTempTitle(e.target.value)}
                      className="px-3 py-2 border rounded-lg bg-slate-700 text-white border-slate-600 flex-1 max-w-md"
                      placeholder="Tournament Title"
                      autoFocus
                    />
                    <button
                      onClick={saveTitle}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEditTitle}
                      className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3 items-center justify-center">
                    <h2 className="text-2xl font-bold text-white">{tournamentConfig.title}</h2>
                    <button
                      onClick={startEditingTitle}
                      className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      title="Edit tournament title"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
            
            {/* Players Overview Grid */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h2 className="text-2xl font-bold text-white mb-4">Tournament Players</h2>
              <div className="grid grid-cols-4 gap-4">
                {tournament.players
                  .map(p => {
                    const startElo = players.find(pl => pl.id === p.id)?.elo || p.elo;
                    const diff = p.elo - startElo;
                    const eloDiff = diff >= 0 ? Math.ceil(diff) : Math.floor(diff);
                    const avgPerf = p.perfCount > 0 ? p.perf / p.perfCount : 0;
                    const totalRP = calcRP(p.games, p.mp, eloDiff);
                    return (
                      <div key={p.id} className="bg-slate-700 p-3 rounded-lg">
                        <div className="text-white font-bold text-center mb-2">{p.name}</div>
                        <div className="text-sm text-center space-y-1">
                          <div className="text-slate-400">
                            {Math.round(p.elo)} <span className={eloDiff > 0 ? 'text-green-400' : eloDiff < 0 ? 'text-red-400' : 'text-slate-400'}>({eloDiff > 0 ? '+' : ''}{eloDiff})</span>
                          </div>
                          <div className="text-slate-400">
                            {isStraightPool()
                              ? <>{p.mp} MP | GD {(p.inningsTotal > 0 ? (p.pointsFor / p.inningsTotal) : 0).toFixed(2)} | HS {p.hs || 0} | {Math.round(avgPerf)} PERF</>
                              : <>{p.mp} MP {config.use_rp && `| ${Math.round(totalRP)} RP`} | {Math.round(avgPerf)} PERF</>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {[...Array(currentRound)].map((_, roundIdx) => {
              const rnd = roundIdx + 1;
              return (
                <div key={rnd} className="space-y-4">
                  <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                    <h2 className="text-2xl font-bold text-white mb-4">Round {rnd} Matches</h2>
                    <div className="grid grid-cols-2 gap-4">
                      {(allRounds[rnd] || []).map(m => (
                        <div
                          key={m.id}
                          className={`bg-slate-700 p-4 rounded-lg border-2 ${m.done ? 'border-green-600' : m.cancelled ? 'border-red-600' : 'border-slate-600'}`}
                        >
                          <div className="flex justify-between mb-2">
                            <span className="text-slate-400">Table {m.tbl}</span>
                            {m.done && <span className="text-green-400 font-bold">✓</span>}
                            {m.cancelled && <span className="text-red-400 font-bold">✗</span>}
                          </div>
                          <div className="grid grid-cols-3 gap-2 items-center text-sm">
                            <div className="text-center">
                              <div className="text-white font-semibold">{m.p1.name}</div>
                              <div className="text-yellow-400 text-xs">GBR: {Math.round(m.p1.elo)}</div>
                            </div>
                            <div className="text-center">
                              {m.bye
                                ? <div className="text-lg font-bold text-blue-300">BYE</div>
                                : m.format === 'straight_pool_14_1'
                                  ? (
                                    <div>
                                      <div className="text-2xl font-bold text-white">{m.p1Points || 0}:{m.p2Points || 0}</div>
                                      <div className="text-slate-400 text-xs">HS: {m.p1HighRun || 0}/{m.p2HighRun || 0} · I:{m.innings || 0}</div>
                                    </div>
                                  )
                                  : <div className="text-2xl font-bold text-white">{m.r1}:{m.r2}</div>}
                            </div>
                            <div className="text-center">
                              <div className="text-white font-semibold">{m.p2.name}</div>
                              <div className="text-yellow-400 text-xs">GBR: {Math.round(m.p2.elo)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                    <h3 className="text-lg font-semibold text-white mb-3">Ranking after Round {rnd}</h3>
                    <div className="space-y-2">
                      {(() => {
                        const standings = {};

                        // Only include players who had joined by this round
                        tournament.players
                          .filter(p => (p.joinedRound || 1) <= rnd)
                          .forEach(p => {
                          const startElo = players.find(pl => pl.id === p.id)?.elo || p.elo;
                          standings[p.id] = {
                            name: p.name,
                            mp: 0,
                            perf: 0,
                            elo: startElo,
                            prevElo: startElo,
                            games: 0,
                            perfCount: 0,
                            racksWon: 0,   // Track racks won
                            racksLost: 0,  // Track racks lost
                            pointsFor: 0,
                            pointsAgainst: 0,
                            inningsTotal: 0,
                            npd: 0,
                            hs: 0,
                            hgd: 0
                          };
                        });

                        for (let r = 1; r <= rnd; r++) {
                          if (r === rnd) {
                            Object.keys(standings).forEach(id => {
                              standings[id].prevElo = standings[id].elo;
                            });
                          }

                          (allRounds[r] || []).forEach(m => {
                            if (m.done && !m.cancelled) {
                              const p1EloBeforeMatch = standings[m.p1.id]?.elo || m.p1.elo;
                              const p2EloBeforeMatch = standings[m.p2.id]?.elo || m.p2.elo;

                              // v1.93: 14.1 experimental accumulation (mirrors recalc)
                              if (m.format === 'straight_pool_14_1' && !m.bye) {
                                const PA = Number(m.p1Points) || 0, PB = Number(m.p2Points) || 0;
                                const inn = Number(m.innings) || 0;
                                const HRA = Number(m.p1HighRun) || 0, HRB = Number(m.p2HighRun) || 0;
                                const tgt = m.target || getSP().startTarget;
                                const sigA = calcStraightPoolSignals(PA, PB, inn, HRA, HRB, tgt, getSP());
                                const sigB = calcStraightPoolSignals(PB, PA, inn, HRB, HRA, tgt, getSP());
                                const gbrCh = calcStraightPoolGbrChange(p1EloBeforeMatch, p2EloBeforeMatch, { p1Points: PA, p2Points: PB, innings: inn, p1HighRun: HRA, p2HighRun: HRB, target: tgt });
                                if (standings[m.p1.id]) {
                                  const s1 = standings[m.p1.id];
                                  s1.mp += PA > PB ? 1 : PA === PB ? 0.5 : 0;
                                  s1.games++;
                                  s1.elo += gbrCh;
                                  s1.perf += calcStraightPoolPerf(p2EloBeforeMatch, sigA.s141);
                                  s1.perfCount++;
                                  s1.pointsFor += PA; s1.pointsAgainst += PB; s1.inningsTotal += inn;
                                  s1.npd += calcNPD(PA, PB, tgt);
                                  s1.hs = Math.max(s1.hs, HRA);
                                  s1.hgd = Math.max(s1.hgd, inn > 0 ? PA / inn : 0);
                                }
                                if (standings[m.p2.id]) {
                                  const s2 = standings[m.p2.id];
                                  s2.mp += PB > PA ? 1 : PB === PA ? 0.5 : 0;
                                  s2.games++;
                                  s2.elo -= gbrCh;
                                  s2.perf += calcStraightPoolPerf(p1EloBeforeMatch, sigB.s141);
                                  s2.perfCount++;
                                  s2.pointsFor += PB; s2.pointsAgainst += PA; s2.inningsTotal += inn;
                                  s2.npd += calcNPD(PB, PA, tgt);
                                  s2.hs = Math.max(s2.hs, HRB);
                                  s2.hgd = Math.max(s2.hgd, inn > 0 ? PB / inn : 0);
                                }
                                return; // done with this 14.1 match
                              }

                              if (standings[m.p1.id]) {
                                const mps = m.bye ? 1 : (m.r1 > m.r2 ? 1 : m.r1 === m.r2 ? 0.5 : 0); // bye = +1 MP (whitepaper §9.3)
                                standings[m.p1.id].mp += mps;
                                standings[m.p1.id].games++;

                                if (!m.bye) {
                                  standings[m.p1.id].racksWon += m.r1;   // Racks won by player 1
                                  standings[m.p1.id].racksLost += m.r2;  // Racks won by opponent
                                  const eloChange = calcEloChange(p1EloBeforeMatch, p2EloBeforeMatch, m.r1, m.r2);
                                  const perfElo = calcPerformanceElo(p2EloBeforeMatch, m.r1, m.r2);
                                  standings[m.p1.id].elo += eloChange;
                                  standings[m.p1.id].perf += perfElo;
                                  standings[m.p1.id].perfCount++;
                                }
                              }

                              if (m.p2.id !== 'bye' && standings[m.p2.id]) {
                                const mps = m.r2 > m.r1 ? 1 : m.r2 === m.r1 ? 0.5 : 0;
                                standings[m.p2.id].mp += mps;
                                standings[m.p2.id].games++;
                                standings[m.p2.id].racksWon += m.r2;   // Racks won by player 2
                                standings[m.p2.id].racksLost += m.r1;  // Racks won by opponent

                                const eloChange = calcEloChange(p1EloBeforeMatch, p2EloBeforeMatch, m.r1, m.r2);
                                const perfElo = calcPerformanceElo(p1EloBeforeMatch, m.r2, m.r1);
                                standings[m.p2.id].elo -= eloChange;
                                standings[m.p2.id].perf += perfElo;
                                standings[m.p2.id].perfCount++;
                              }
                            }
                          });
                        }

                        const eloBeforeRound = {};
                        tournament.players
                          .filter(p => (p.joinedRound || 1) <= rnd)
                          .forEach(p => {
                          const startElo = players.find(pl => pl.id === p.id)?.elo || p.elo;
                          let elo = startElo;

                          for (let r = 1; r < rnd; r++) {
                            (allRounds[r] || []).forEach(m => {
                              if (m.done && !m.cancelled && !m.bye) {
                                if (m.format === 'straight_pool_14_1') {
                                  if (m.p1.id === p.id) {
                                    elo += calcStraightPoolGbrChange(elo, m.p2.elo, { p1Points: m.p1Points, p2Points: m.p2Points, innings: m.innings, p1HighRun: m.p1HighRun, p2HighRun: m.p2HighRun, target: m.target });
                                  } else if (m.p2.id === p.id) {
                                    elo -= calcStraightPoolGbrChange(m.p1.elo, elo, { p1Points: m.p1Points, p2Points: m.p2Points, innings: m.innings, p1HighRun: m.p1HighRun, p2HighRun: m.p2HighRun, target: m.target });
                                  }
                                } else if (m.p1.id === p.id) {
                                  const eloChange = calcEloChange(elo, m.p2.elo, m.r1, m.r2);
                                  elo += eloChange;
                                } else if (m.p2.id === p.id) {
                                  const eloChange = calcEloChange(m.p1.elo, elo, m.r1, m.r2);
                                  elo -= eloChange;
                                }
                              }
                            });
                          }
                          eloBeforeRound[p.id] = elo;
                        });

                        const roundPerf = {};
                        (allRounds[rnd] || []).forEach(m => {
                          if (m.done && !m.cancelled) {
                            if (!m.bye) {
                              if (m.format === 'straight_pool_14_1') {
                                const tgt = m.target || getSP().startTarget;
                                const sigA = calcStraightPoolSignals(m.p1Points, m.p2Points, m.innings, m.p1HighRun, m.p2HighRun, tgt, getSP());
                                const sigB = calcStraightPoolSignals(m.p2Points, m.p1Points, m.innings, m.p2HighRun, m.p1HighRun, tgt, getSP());
                                const p2EloAtMatch = eloBeforeRound[m.p2.id] || m.p2.elo;
                                const p1EloAtMatch = eloBeforeRound[m.p1.id] || m.p1.elo;
                                roundPerf[m.p1.id] = calcStraightPoolPerf(p2EloAtMatch, sigA.s141);
                                roundPerf[m.p2.id] = calcStraightPoolPerf(p1EloAtMatch, sigB.s141);
                              } else {
                                const p2EloAtMatch = eloBeforeRound[m.p2.id] || m.p2.elo;
                                roundPerf[m.p1.id] = calcPerformanceElo(p2EloAtMatch, m.r1, m.r2);

                                const p1EloAtMatch = eloBeforeRound[m.p1.id] || m.p1.elo;
                                roundPerf[m.p2.id] = calcPerformanceElo(p1EloAtMatch, m.r2, m.r1);
                              }
                            } else {
                              roundPerf[m.p1.id] = 0;
                            }
                          }
                        });

                        const avgPerf = {};
                        Object.entries(standings).forEach(([id, s]) => {
                          avgPerf[id] = s.perfCount > 0 ? s.perf / s.perfCount : 0;
                        });

                        // Calculate RP for each player
                        const rpData = {};
                        const rpThisRound = {};
                        if (config.use_rp) {
                          Object.entries(standings).forEach(([id, s]) => {
                            const startElo = players.find(pl => pl.id === parseInt(id))?.elo || s.elo;
                            const totalEloGain = s.elo - startElo;
                            const totalRP = calcRP(s.games, s.mp, totalEloGain);
                            rpData[id] = totalRP;

                            // Calculate RP for previous rounds
                            const prevElo = s.prevElo;
                            const prevEloGain = prevElo - startElo;
                            const gamesBeforeThisRound = s.games - 1;
                            
                            // Calculate MP before this round
                            let mpBeforeThisRound = s.mp;
                            (allRounds[rnd] || []).forEach(m => {
                              if ((m.p1.id === parseInt(id) || m.p2.id === parseInt(id)) && m.done && !m.cancelled) {
                                const isP1 = m.p1.id === parseInt(id);
                                let thisMp;
                                if (m.format === 'straight_pool_14_1' && !m.bye) {
                                  const myPts = isP1 ? (m.p1Points || 0) : (m.p2Points || 0);
                                  const oppPts = isP1 ? (m.p2Points || 0) : (m.p1Points || 0);
                                  thisMp = myPts > oppPts ? 1 : myPts === oppPts ? 0.5 : 0;
                                } else {
                                  const myRacks = isP1 ? m.r1 : m.r2;
                                  const oppRacks = isP1 ? m.r2 : m.r1;
                                  thisMp = m.bye && isP1 ? 1 : (myRacks > oppRacks ? 1 : myRacks === oppRacks ? 0.5 : 0);
                                }
                                mpBeforeThisRound -= thisMp;
                              }
                            });
                            
                            const prevRP = calcRP(gamesBeforeThisRound, mpBeforeThisRound, prevEloGain);
                            rpThisRound[id] = totalRP - prevRP;
                          });
                        }

                        return Object.entries(standings)
                          .map(([id, s]) => ({
                            ...s,
                            id: parseInt(id),
                            avgPerf: s.perfCount > 0 ? s.perf / s.perfCount : 0
                          }))
                          .sort(compareRankings)
                          .map((s, i) => {
                            const id = s.id.toString();
                            const diffRaw = s.elo - s.prevElo;
                            const diff = diffRaw >= 0 ? Math.ceil(diffRaw) : Math.floor(diffRaw);
                            const thisRoundPerf = roundPerf[id] || 0;
                            const avgPerfValue = s.avgPerf;
                            const rp = rpData[id] || 0;
                            const rpThisRoundValue = rpThisRound[id] || 0;
                            // v1.92: this-round 14.1 stats for All Rounds tab
                            let spRound = null;
                            if (isStraightPool()) {
                              const rm = (allRounds[rnd] || []).find(m => !m.bye && m.done && !m.cancelled && (m.p1.id === s.id || m.p2.id === s.id));
                              if (rm) {
                                const isP1 = rm.p1.id === s.id;
                                const pts = isP1 ? (rm.p1Points || 0) : (rm.p2Points || 0);
                                const opp = isP1 ? (rm.p2Points || 0) : (rm.p1Points || 0);
                                const hr = isP1 ? (rm.p1HighRun || 0) : (rm.p2HighRun || 0);
                                spRound = { pts, opp, gd: rm.innings > 0 ? pts / rm.innings : 0, hs: hr };
                              }
                            }
                            return (
                              <div key={id} className="bg-slate-700 p-3 rounded-lg">
                                <div className="flex justify-between items-center">
                                  <div className="flex gap-3">
                                    <span className="text-slate-400 font-bold">#{i + 1}</span>
                                    <span className="text-white font-medium">{s.name}</span>
                                  </div>
                                  <div className="flex gap-4 text-sm">
                                    {config.ranking_system === 'classic' && (
                                      <div className="text-right">
                                        <div className="text-slate-400">Score</div>
                                        <div className="text-yellow-400 font-bold">{classicStandingScore(s.mp, avgPerfValue).toFixed(4)}</div>
                                      </div>
                                    )}
                                    <div className="text-right">
                                      <div className="text-slate-400">MPs</div>
                                      <div className={`font-bold ${config.ranking_system === 'racks' ? 'text-yellow-400' : 'text-white'}`}>{s.mp}</div>
                                    </div>
                                    {config.ranking_system === 'racks' && !isStraightPool() && (
                                      <div className="text-right">
                                        <div className="text-slate-400">Rack Diff</div>
                                        <div className="text-yellow-400 font-bold">{(s.racksWon || 0) - (s.racksLost || 0)}</div>
                                      </div>
                                    )}
                                    {isStraightPool() && (
                                      <>
                                        <div className="text-right">
                                          <div className="text-slate-400">P+ / P-</div>
                                          <div className="text-white font-bold">{spRound ? `${spRound.pts}/${spRound.opp}` : '—'}</div>
                                        </div>
                                        <div className="text-right">
                                          <div className="text-slate-400">Point Diff</div>
                                          <div className="text-yellow-400 font-bold">{spRound ? `${(spRound.pts - spRound.opp) >= 0 ? '+' : ''}${spRound.pts - spRound.opp}` : '—'}</div>
                                        </div>
                                        <div className="text-right">
                                          <div className="text-slate-400">GD (rnd)</div>
                                          <div className="text-white font-bold">{spRound ? spRound.gd.toFixed(2) : '—'}</div>
                                        </div>
                                        <div className="text-right">
                                          <div className="text-slate-400">HS (rnd)</div>
                                          <div className="text-white font-bold">{spRound ? spRound.hs : '—'}</div>
                                        </div>
                                      </>
                                    )}
                                    <div className="text-right">
                                      <div className="text-slate-400">{isStraightPool() ? 'Match PERF' : 'Round Perf'}</div>
                                      <div className="text-white font-bold">{Math.round(thisRoundPerf)}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-slate-400">Avg Perf</div>
                                      <div className="text-yellow-400 font-bold">{Math.round(avgPerfValue)}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-slate-400">GBR</div>
                                      <div className="text-white font-bold">{Math.round(s.elo)}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-slate-400">Δ GBR</div>
                                      <div className={`font-bold ${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                                        {diff > 0 ? '+' : ''}{diff}
                                      </div>
                                    </div>
                                    {config.use_rp && (
                                      <div className="text-right">
                                        <div className="text-slate-400">Round RP</div>
                                        <div className={`font-bold ${rpThisRoundValue > 0 ? 'text-green-400' : 'text-slate-400'}`}>
                                          {rpThisRoundValue > 0 ? '+' : ''}{Math.round(rpThisRoundValue)}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          });
                      })()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showAddModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border border-slate-700">
              <h2 className="text-xl font-bold text-white mb-4">Add Player to Round {currentRound}</h2>
              <div className="space-y-4">
                {clubDatabase.length > 0 && (
                  <div>
                    <label className="text-white block mb-2">Select from Club Database:</label>
                    <select
                      onChange={e => {
                        const selectedPlayer = clubDatabase.find(p => p.id === parseInt(e.target.value));
                        if (selectedPlayer) {
                          setNewPlayer({
                            name: selectedPlayer.name,
                            elo: selectedPlayer.elo
                          });
                          e.target.value = ''; // Reset dropdown
                        }
                      }}
                      className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg mb-2"
                    >
                      <option value="">-- Select a player --</option>
                      {clubDatabase
                        .filter(dbPlayer => {
                          // Hide players already in the tournament
                          const inTournament = tournament?.players.some(p => 
                            p.name.toLowerCase() === dbPlayer.name.toLowerCase()
                          );
                          const inPlayers = players.some(p => 
                            p.name.toLowerCase() === dbPlayer.name.toLowerCase()
                          );
                          return !inTournament && !inPlayers;
                        })
                        .map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} (GBR: {p.elo})
                          </option>
                        ))}
                    </select>
                    {clubDatabase.length > 0 && clubDatabase.filter(dbPlayer => {
                      const inTournament = tournament?.players.some(p => 
                        p.name.toLowerCase() === dbPlayer.name.toLowerCase()
                      );
                      const inPlayers = players.some(p => 
                        p.name.toLowerCase() === dbPlayer.name.toLowerCase()
                      );
                      return !inTournament && !inPlayers;
                    }).length === 0 && (
                      <p className="text-yellow-400 text-sm">All database players already in tournament</p>
                    )}
                  </div>
                )}
                <div>
                  <label className="text-white block mb-2">{clubDatabase.length > 0 ? 'Or enter manually:' : 'Enter player details:'}</label>
                  <input
                    type="text"
                    placeholder="Player Name"
                    value={newPlayer.name}
                    onChange={e => setNewPlayer({ ...newPlayer, name: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg mb-2"
                  />
                  <input
                    type="number"
                    placeholder="GBR Rating"
                    value={newPlayer.elo}
                    onChange={e => setNewPlayer({ ...newPlayer, elo: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={addPlayerToTournament}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Add Player
                  </button>
                  <button
                    onClick={() => {
                      setShowAddModal(false);
                      setNewPlayer({ name: '', elo: 1500 });
                    }}
                    className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showRemovePlayerModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-2xl w-full mx-4 border border-slate-700">
              <h2 className="text-xl font-bold text-white mb-4">Remove Players from Round {currentRound}</h2>

              <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded-lg">
                <p className="text-red-200 text-sm font-semibold">
                  ⚠️ WARNING: This will regenerate ALL matches for Round {currentRound} with new pairings!<br />
                  ⚠️ Any match results will be LOST!
                </p>
              </div>

              <div className="mb-4">
                <h3 className="text-white font-semibold mb-2">Select players to remove:</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {tournament.players
                    .filter(p => !p.removed)
                    .map(p => (
                      <label key={p.id} className="flex items-center gap-3 p-2 bg-slate-700 rounded cursor-pointer hover:bg-slate-600">
                        <input
                          type="checkbox"
                          checked={playersToRemove.includes(p.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setPlayersToRemove([...playersToRemove, p.id]);
                            } else {
                              setPlayersToRemove(playersToRemove.filter(id => id !== p.id));
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-white">{p.name} (GBR: {Math.round(p.elo)}, MPs: {p.mp})</span>
                      </label>
                    ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={removePlayersFromRound}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                  disabled={playersToRemove.length === 0}
                >
                  Remove {playersToRemove.length} Player{playersToRemove.length !== 1 ? 's' : ''} & Regenerate Round
                </button>
                <button
                  onClick={() => {
                    setPlayersToRemove([]);
                    setShowRemovePlayerModal(false);
                  }}
                  className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showSettings && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border border-slate-700">
              <h2 className="text-xl font-bold text-white mb-4">Tournament Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-white block mb-2">d-value (GBR spread)</label>
                  <input
                    type="number"
                    value={config.d}
                    onChange={e => setConfig({ ...config, d: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-white block mb-2">k-factor Match (k_m)</label>
                  <input
                    type="number"
                    value={config.k_m}
                    onChange={e => setConfig({ ...config, k_m: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-white block mb-2">k-factor Rack (k_r)</label>
                  <input
                    type="number"
                    value={config.k_r}
                    onChange={e => setConfig({ ...config, k_r: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-white block mb-2">Max racks per match</label>
                  <input
                    type="number"
                    value={config.max_games}
                    onChange={e => setConfig({ ...config, max_games: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-white block mb-2">Total rounds</label>
                  <input
                    type="number"
                    value={config.default_rounds}
                    onChange={e => setConfig({ ...config, default_rounds: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg"
                  />
                </div>
                
                <div className="border-t border-slate-600 pt-4 mt-4">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-white font-bold">Configuration Presets</h3>
                    <button
                      onClick={() => setShowConfigPresets(!showConfigPresets)}
                      className="px-3 py-1 bg-slate-600 text-white rounded text-sm hover:bg-slate-500"
                    >
                      {showConfigPresets ? 'Hide' : 'Manage Presets'}
                    </button>
                  </div>
                  
                  {showConfigPresets && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        {configPresets.map((preset, index) => (
                          <div key={index} className="bg-slate-700 p-3 rounded-lg">
                            <div className="flex justify-between items-start mb-2">
                              <div className="font-semibold text-white text-sm">{preset.name}</div>
                              <button
                                onClick={() => deleteConfigPreset(index)}
                                className="text-red-400 hover:text-red-300"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="text-xs text-slate-300 mb-2">
                              d={preset.d} | k_m={preset.k_m} | k_r={preset.k_r}
                            </div>
                            <button
                              onClick={() => loadConfigPreset(preset)}
                              className="w-full px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                            >
                              Load
                            </button>
                          </div>
                        ))}
                      </div>
                      
                      <div className="bg-slate-700 p-3 rounded-lg">
                        <label className="text-white text-sm block mb-2">Save Current Config As:</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Preset name"
                            value={newPresetName}
                            onChange={e => setNewPresetName(e.target.value)}
                            className="flex-1 px-3 py-2 bg-slate-600 text-white rounded text-sm"
                          />
                          <button
                            onClick={saveConfigPreset}
                            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="pt-2">
                  <button
                    onClick={() => setShowSettings(false)}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showClubDatabaseModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-4xl w-full mx-4 border border-slate-700 max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-white mb-4">Club Database</h2>
              
              <div className="mb-6">
                <label className="block text-white mb-2">Upload CSV File (Name, GBR):</label>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleCSVUpload}
                  className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg"
                />
                <p className="text-slate-400 text-sm mt-2">
                  Supports comma-separated or tab-separated files. Format: Name, GBR
                </p>
              </div>

              {tempClubData.length > 0 && (
                <>
                  <h3 className="text-lg font-bold text-white mb-3">
                    Players ({tempClubData.length})
                  </h3>
                  <div className="space-y-2 mb-6 max-h-96 overflow-y-auto">
                    {tempClubData.map(player => (
                      <div key={player.id} className="flex gap-3 items-center bg-slate-700 p-3 rounded-lg">
                        <input
                          type="text"
                          value={player.name}
                          onChange={e => updateTempClubPlayer(player.id, 'name', e.target.value)}
                          className="flex-1 px-3 py-2 bg-slate-600 text-white rounded"
                        />
                        <input
                          type="number"
                          value={player.elo}
                          onChange={e => updateTempClubPlayer(player.id, 'elo', e.target.value)}
                          className="w-24 px-3 py-2 bg-slate-600 text-white rounded"
                        />
                        <button
                          onClick={() => deleteTempClubPlayer(player.id)}
                          className="p-2 bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex gap-3">
                {tempClubData.length > 0 && (
                  <button
                    onClick={saveClubDatabase}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Save Club Database ({tempClubData.length} players)
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowClubDatabaseModal(false);
                    setTempClubData([]);
                  }}
                  className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                >
                  {tempClubData.length > 0 ? 'Cancel' : 'Close'}
                </button>
              </div>

              {clubDatabase.length > 0 && (
                <div className="mt-4 p-3 bg-blue-900 border border-blue-700 rounded-lg">
                  <p className="text-blue-200 text-sm">
                    ℹ️ Current database has {clubDatabase.length} players. Upload a new file to replace it.
                  </p>
                </div>
              )}

              {/* Emergency Clear Autosave Button - positioned low to avoid accidental clicks */}
              <div className="mt-6 pt-4 border-t border-slate-700">
                <button
                  onClick={() => setShowClearAutosaveConfirm(true)}
                  className="w-full px-4 py-2 bg-red-900 text-red-200 rounded-lg hover:bg-red-800 border border-red-700 text-sm"
                >
                  Clear Autosave
                </button>
                <p className="text-slate-500 text-xs mt-2 text-center">
                  Emergency: Removes saved tournament recovery data from browser
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Clear Autosave Confirmation Modal */}
        {/* No-Legal-Bye Error Modal (whitepaper §9.2: repeated byes are illegal) */}
        {showByeError && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border-2 border-red-600">
              <h2 className="text-xl font-bold text-red-400 mb-4 flex items-center gap-2">
                <XCircle className="w-6 h-6" />
                No Legal Bye Available
              </h2>

              <div className="bg-red-900 border border-red-700 rounded-lg p-4 mb-4">
                <p className="text-red-200 text-sm mb-2">
                  The field has an odd number of players, but every active player has
                  already received a bye. A repeated bye is not allowed, so the round
                  could not be generated.
                </p>
                <p className="text-red-200 text-sm">
                  To continue, the tournament director should reduce the remaining round
                  count, add an eligible player, or resolve the pairing manually using
                  the Manual Pairing Editor.
                </p>
              </div>

              <button
                onClick={() => setShowByeError(false)}
                className="w-full px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 font-semibold"
              >
                Understood
              </button>
            </div>
          </div>
        )}

        {showClearAutosaveConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border-2 border-red-600">
              <h2 className="text-xl font-bold text-red-400 mb-4 flex items-center gap-2">
                <XCircle className="w-6 h-6" />
                Clear Autosave Data?
              </h2>
              
              <div className="bg-red-900 border border-red-700 rounded-lg p-4 mb-4">
                <p className="text-red-200 text-sm mb-2">
                  This will remove the saved tournament recovery data from this browser.
                </p>
                <p className="text-red-200 text-sm">
                  The current session will remain open until you refresh.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearAutosaveConfirm(false)}
                  className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmClearAutosave}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold"
                >
                  Clear Autosave
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Undo Advance Confirmation Modal */}
        {showUndoAdvanceConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border-2 border-yellow-600">
              <h2 className="text-xl font-bold text-yellow-400 mb-4 flex items-center gap-2">
                <XCircle className="w-6 h-6" />
                Cancel Current Round?
              </h2>
              
              <div className="bg-yellow-900 border border-yellow-700 rounded-lg p-4 mb-4">
                <p className="text-yellow-200 text-sm mb-2">
                  This will cancel the current round and revert to the exact state before "Next Round" was pressed.
                </p>
                <p className="text-yellow-200 text-sm font-semibold">
                  All match results entered in Round {currentRound} will be lost.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowUndoAdvanceConfirm(false)}
                  className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmUndoAdvance}
                  className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-semibold"
                >
                  Revert Round
                </button>
              </div>
            </div>
          </div>
        )}

        {showSeedingModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg max-w-2xl w-full mx-4 border border-slate-700 max-h-[80vh] flex flex-col">
              <div className="p-6 overflow-y-auto flex-1">
                <h2 className="text-xl font-bold text-white mb-4">Round 1 Seeding</h2>
              
              <div className="flex gap-3 mb-4 flex-wrap">
                <button
                  onClick={() => setSeedMethod('random')}
                  className={`px-4 py-2 rounded-lg font-semibold ${seedMethod === 'random' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  Random
                </button>
                <button
                  onClick={() => setSeedMethod('cross_elo')}
                  className={`px-4 py-2 rounded-lg font-semibold ${seedMethod === 'cross_elo' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  Cross GBR
                </button>
                <button
                  onClick={() => setSeedMethod('elo')}
                  className={`px-4 py-2 rounded-lg font-semibold ${seedMethod === 'elo' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  GBR Balanced
                </button>
                <button
                  onClick={() => { setSeedMethod('manual'); setManualSeeding([]); }}
                  className={`px-4 py-2 rounded-lg font-semibold ${seedMethod === 'manual' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  Manual Selection
                </button>
                <button
                  onClick={() => setShowSeedingImport(!showSeedingImport)}
                  className={`px-4 py-2 rounded-lg font-semibold ${showSeedingImport ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  Import from CSV
                </button>
              </div>

              {showSeedingImport && (
                <div className="bg-slate-700 p-4 rounded-lg mb-4">
                  <label className="text-white block mb-2">Upload Seeding CSV:</label>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleSeedingCSVUpload}
                    className="w-full px-4 py-2 bg-slate-600 text-white rounded-lg"
                  />
                  <p className="text-slate-400 text-sm mt-2">
                    CSV should have player names in seeding order (one per line). First column will be used.
                  </p>
                  <p className="text-slate-300 text-xs mt-1">
                    Example format: <code className="bg-slate-600 px-1">Name</code> or <code className="bg-slate-600 px-1">Player,Other Data</code>
                  </p>
                </div>
              )}

              {seedMethod === 'manual' && (
                <div className="bg-slate-700 p-4 rounded-lg mb-4">
                  <p className="text-slate-300 text-sm mb-3">Select players in order for Round 1:</p>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {[...Array(players.length)].map((_, i) => {
                    const availablePlayers = players.filter(p => !manualSeeding.includes(p.id));
                    const selectedId = manualSeeding[i];
                    const selectedPlayer = players.find(p => p.id === selectedId);

                    return (
                      <div key={i} className="flex gap-2 items-center">
                        <span className="text-slate-400 font-bold w-8">#{i + 1}</span>
                        <select
                          value={selectedId || ''}
                          onChange={e => {
                            const newSeeding = [...manualSeeding];
                            newSeeding[i] = parseInt(e.target.value);
                            setManualSeeding(newSeeding.filter(id => id));
                          }}
                          className="flex-1 px-3 py-2 bg-slate-600 text-white rounded"
                        >
                          <option value="">-- Select Player --</option>
                          {selectedPlayer && <option value={selectedPlayer.id}>{selectedPlayer.name}</option>}
                          {availablePlayers.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        {selectedPlayer && (
                          <span className="text-yellow-400 text-sm">GBR: {selectedPlayer.elo}</span>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}

              <div className="bg-blue-900 border border-blue-700 rounded-lg p-3 mb-4">
                <p className="text-blue-200 text-sm">
                  <strong>Current method:</strong> {
                    seedMethod === 'random' ? 'Random' :
                    seedMethod === 'cross_elo' ? 'Cross GBR' :
                    seedMethod === 'elo' ? 'GBR Balanced' :
                    seedMethod === 'manual' ? 'Manual Selection' :
                    'Random'  // Default fallback
                  }
                </p>
              </div>
              </div>

              <div className="border-t border-slate-700 p-4 bg-slate-800">
                <button
                  onClick={() => setShowSeedingModal(false)}
                  className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {showAbortConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border-2 border-red-600">
              <h2 className="text-xl font-bold text-red-400 mb-4 flex items-center gap-2">
                <XCircle className="w-6 h-6" />
                Abort Tournament?
              </h2>
              
              <div className="bg-red-900 border border-red-700 rounded-lg p-4 mb-4">
                <p className="text-red-200 text-sm font-semibold mb-2">
                  ⚠️ WARNING: This action cannot be undone!
                </p>
                <p className="text-red-200 text-sm">
                  All match results and tournament progress will be permanently lost.
                </p>
              </div>

              <div className="bg-slate-700 rounded-lg p-3 mb-4">
                <p className="text-white text-sm font-semibold mb-1">Will be preserved:</p>
                <ul className="text-slate-300 text-sm list-disc list-inside">
                  <li>Player list</li>
                  <li>Tournament settings</li>
                  <li>Club database</li>
                </ul>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={abortTournament}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold"
                >
                  Yes, Abort Tournament
                </button>
                <button
                  onClick={() => setShowAbortConfirm(false)}
                  className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showRegenerateConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border-2 border-purple-600">
              <h2 className="text-xl font-bold text-amber-400 mb-4 flex items-center gap-2">
                <RotateCw className="w-6 h-6" />
                Regenerate Round {regenerateRoundNum}?
              </h2>
              
              <div className="bg-amber-900 border border-amber-700 rounded-lg p-4 mb-4">
                <p className="text-amber-200 text-sm font-semibold mb-2">
                  ⚠️ This will regenerate pairings for Round {regenerateRoundNum}
                </p>
                <p className="text-amber-200 text-sm">
                  • All current matches and scores in Round {regenerateRoundNum} will be deleted<br/>
                  • New pairings will be created based on standings from previous rounds<br/>
                  • Opponent history will be preserved
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => regenerateRound(regenerateRoundNum)}
                  className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-semibold"
                >
                  Yes, Regenerate
                </button>
                <button
                  onClick={() => setShowRegenerateConfirm(false)}
                  className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Player Confirmation Modal */}
        {showDeleteConfirm && playerToDelete && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border-2 border-red-600">
              <h2 className="text-xl font-bold text-red-400 mb-4 flex items-center gap-2">
                <Trash2 className="w-6 h-6" />
                Delete {playerToDelete.name}?
              </h2>
              
              <div className="bg-red-900 border border-red-700 rounded-lg p-4 mb-4">
                <p className="text-red-200 text-sm">
                  Delete this player from the tournament? This will remove all their matches.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setPlayerToDelete(null);
                  }}
                  className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={performDeletePlayer}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manual Pairing Warnings Confirmation Modal */}
        {showManualPairingWarnings && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border-2 border-yellow-600">
              <h2 className="text-xl font-bold text-yellow-400 mb-4 flex items-center gap-2">
                <XCircle className="w-6 h-6" />
                Manual Pairing Warnings
              </h2>
              
              <div className="bg-yellow-900 border border-yellow-700 rounded-lg p-4 mb-4 max-h-60 overflow-y-auto">
                <p className="text-yellow-200 text-sm font-semibold mb-2">
                  The following issues were detected:
                </p>
                <ul className="text-yellow-200 text-sm space-y-1">
                  {manualPairingWarnings.map((warning, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-yellow-400 mt-0.5">•</span>
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowManualPairingWarnings(false);
                    setManualPairingWarnings([]);
                  }}
                  className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={performApplyManualPairings}
                  className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-semibold"
                >
                  Proceed Anyway
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Manual Pairing Editor Modal (Fix #3) */}
        {showManualPairings && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg max-w-4xl w-full mx-4 border border-purple-700 max-h-[85vh] flex flex-col">
              <div className="p-6 overflow-y-auto flex-1">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <Edit className="w-6 h-6 text-purple-400" />
                  Manual Pairing Editor - Round {manualPairingsRound}
                </h2>
                
                <div className="bg-amber-900 border border-amber-700 rounded-lg p-3 mb-4">
                  <p className="text-amber-200 text-sm">
                    <strong>Direct Pairing Control:</strong> Edit match pairings directly. Swap players between matches using dropdowns. System will warn about repeat pairings and bye eligibility but allows TD override.
                  </p>
                </div>

                <div className="space-y-3">
                  {manualPairingsData.map((pairing, idx) => {
                    const allPlayers = tournament.players.filter(p => !p.removed);
                    const p1 = allPlayers.find(p => p.id === pairing.p1Id);
                    const p2 = pairing.isBye 
                      ? { id: 'bye', name: 'FREILOS' }
                      : allPlayers.find(p => p.id === pairing.p2Id);
                    
                    return (
                      <div key={idx} className="bg-slate-700 p-4 rounded-lg border border-slate-600">
                        <div className="flex items-center gap-3">
                          <span className="text-slate-400 font-bold min-w-[80px]">
                            {pairing.isBye ? 'Bye:' : `Table ${idx + 1}:`}
                          </span>
                          
                          {/* Player 1 dropdown */}
                          <select
                            value={pairing.p1Id}
                            onChange={(e) => swapPlayersInPairings(idx, 'p1', parseInt(e.target.value))}
                            className="flex-1 px-3 py-2 bg-slate-600 text-white rounded"
                          >
                            {allPlayers.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} (GBR: {Math.round(p.elo)})
                              </option>
                            ))}
                          </select>
                          
                          {!pairing.isBye && (
                            <>
                              <span className="text-white font-bold">vs</span>
                              
                              {/* Player 2 dropdown */}
                              <select
                                value={pairing.p2Id}
                                onChange={(e) => swapPlayersInPairings(idx, 'p2', parseInt(e.target.value))}
                                className="flex-1 px-3 py-2 bg-slate-600 text-white rounded"
                              >
                                {allPlayers.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} (GBR: {Math.round(p.elo)})
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                        </div>
                        
                        {/* Show original pairing for reference */}
                        {(p1?.name !== pairing.originalP1 || (p2?.name !== pairing.originalP2 && !pairing.isBye)) && (
                          <div className="mt-2 text-sm text-yellow-400">
                            Original: {pairing.originalP1} {pairing.isBye ? '' : `vs ${pairing.originalP2}`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Validation warnings */}
                {(() => {
                  const warnings = validateManualPairings();
                  if (warnings.length > 0) {
                    return (
                      <div className="mt-4 bg-yellow-900 border border-yellow-700 rounded-lg p-3">
                        <p className="text-yellow-200 font-semibold mb-2">⚠️ Warnings:</p>
                        <ul className="text-yellow-200 text-sm space-y-1">
                          {warnings.map((w, i) => (
                            <li key={i}>• {w}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              <div className="border-t border-slate-700 p-4 bg-slate-800 flex gap-3">
                <button
                  onClick={applyManualPairings}
                  className="flex-1 px-4 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-semibold"
                >
                  Apply Manual Pairings
                </button>
                <button
                  onClick={() => {
                    setShowManualPairings(false);
                    setManualPairingsData([]);
                  }}
                  className="flex-1 px-4 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Toast */}
        {errorMessage && (
          <div className="fixed bottom-4 right-4 z-50 animate-slide-in">
            <div className="bg-red-600 text-white px-6 py-4 rounded-lg shadow-lg border-2 border-red-400 max-w-md">
              <div className="flex items-start gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="font-semibold">Error</p>
                  <p className="text-sm">{errorMessage}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PoolTournamentApp;
