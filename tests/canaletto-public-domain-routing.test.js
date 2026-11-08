import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validatePublicState } from '../src/application/canalettoPublicState.js';
import {
  CANALETTO_PUBLIC_HOSTNAME,
  isCanalettoArchive2026Path,
  normalizeCanalettoPath,
  resolveCanalettoRoute
} from '../src/canaletto/publicDomain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIRECTOR_HOSTNAME = 'rack-hub-canaletto.web.app';

// ---------------------------------------------------------------------------
// resolveCanalettoRoute() — pure routing-precedence helper (no window/DOM
// needed, per docs task item 12's "test pure routing helpers instead").
// ---------------------------------------------------------------------------

test('custom-domain root (no query) resolves to the landing page', () => {
  const route = resolveCanalettoRoute({ hostname: CANALETTO_PUBLIC_HOSTNAME, pathname: '/', search: '' });
  assert.deepEqual(route, { kind: 'landing' });
});

test('custom-domain /2026 resolves to the static archive', () => {
  const route = resolveCanalettoRoute({ hostname: CANALETTO_PUBLIC_HOSTNAME, pathname: '/2026', search: '' });
  assert.deepEqual(route, { kind: 'archive2026' });
});

test('custom-domain /2026/ (trailing slash) resolves to the same static archive', () => {
  const route = resolveCanalettoRoute({ hostname: CANALETTO_PUBLIC_HOSTNAME, pathname: '/2026/', search: '' });
  assert.deepEqual(route, { kind: 'archive2026' });
});

test('any other custom-domain path (not /2026) falls back to the landing page', () => {
  const route = resolveCanalettoRoute({ hostname: CANALETTO_PUBLIC_HOSTNAME, pathname: '/whatever', search: '' });
  assert.deepEqual(route, { kind: 'landing' });
});

test('explicit ?live=livescore wins over the custom-domain root default', () => {
  const route = resolveCanalettoRoute({ hostname: CANALETTO_PUBLIC_HOSTNAME, pathname: '/', search: '?live=livescore' });
  assert.deepEqual(route, { kind: 'live', view: 'livescore', onPublicDomain: true });
});

test('explicit ?live=... wins over /2026 too — the static archive never shadows an explicit live route', () => {
  const route = resolveCanalettoRoute({ hostname: CANALETTO_PUBLIC_HOSTNAME, pathname: '/2026', search: '?live=bracket' });
  assert.deepEqual(route, { kind: 'live', view: 'bracket', onPublicDomain: true });
});

test('director host root (no query) remains the director app', () => {
  const route = resolveCanalettoRoute({ hostname: DIRECTOR_HOSTNAME, pathname: '/', search: '' });
  assert.deepEqual(route, { kind: 'director' });
});

test('director host /2026 is NOT the archive — the hostname gate, not the path, decides', () => {
  const route = resolveCanalettoRoute({ hostname: DIRECTOR_HOSTNAME, pathname: '/2026', search: '' });
  assert.deepEqual(route, { kind: 'director' });
});

test('director host ?live=livescore still resolves to the live (Firebase-backed) view, onPublicDomain false', () => {
  const route = resolveCanalettoRoute({ hostname: DIRECTOR_HOSTNAME, pathname: '/', search: '?live=livescore' });
  assert.deepEqual(route, { kind: 'live', view: 'livescore', onPublicDomain: false });
});

test('director host ?legacy=1 still resolves to the legacy app', () => {
  const route = resolveCanalettoRoute({ hostname: DIRECTOR_HOSTNAME, pathname: '/', search: '?legacy=1' });
  assert.deepEqual(route, { kind: 'legacy' });
});

test('normalizeCanalettoPath collapses trailing slashes and empty string to root', () => {
  assert.equal(normalizeCanalettoPath('/2026/'), '/2026');
  assert.equal(normalizeCanalettoPath('/2026'), '/2026');
  assert.equal(normalizeCanalettoPath('/'), '/');
  assert.equal(normalizeCanalettoPath(''), '/');
});

test('isCanalettoArchive2026Path only matches /2026 and /2026/, nothing else', () => {
  assert.equal(isCanalettoArchive2026Path('/2026'), true);
  assert.equal(isCanalettoArchive2026Path('/2026/'), true);
  assert.equal(isCanalettoArchive2026Path('/'), false);
  assert.equal(isCanalettoArchive2026Path('/20260'), false);
  assert.equal(isCanalettoArchive2026Path('/2026/extra'), false);
});

// ---------------------------------------------------------------------------
// Static 2026 archive snapshot — must be real, valid, and Firebase-free.
// ---------------------------------------------------------------------------

test('the bundled 2026 archive snapshot is present, valid publicState shape, and has no transient live-draft data', () => {
  const raw = readFileSync(path.join(__dirname, '../src/canaletto/archive/canalettoCup2026.json'), 'utf8');
  const archive = JSON.parse(raw);

  const result = validatePublicState(archive);
  assert.ok(result.valid, `archive snapshot must validate as publicState: ${JSON.stringify(result.errors)}`);

  assert.deepEqual(archive.liveDraftScores, {}, 'archive must contain no unfinished live draft scores');

  // Official results must actually be present — a byte-for-byte reproduction
  // of the completed tournament, not an empty/fresh event.
  assert.ok(archive.blockA.tournament.roster.length > 0);
  assert.ok(archive.blockB.tournament.roster.length > 0);
  assert.ok(archive.blockA.tournament.players.length > 0);
  assert.ok(archive.blockB.tournament.players.length > 0);
  assert.ok(archive.ko.final, 'archive must include the completed KO final');
});

// Checks actual `import ... from '...'` specifiers only — these files'
// own header comments legitimately mention "firebase"/"useCloudPublicEvent"
// to document the guarantee, so a plain substring search over the whole
// source would false-positive on the comment itself. Non-greedy up to the
// first `from` after each `import` keyword so this also matches a
// multi-line `import { a, b, c } from '...'` block, not just single-line
// imports.
const importSpecifiers = (source) => [...source.matchAll(/import\s+[\s\S]*?\bfrom\s+['"](.+?)['"]/g)].map((m) => m[1]);

// Recursively follows RELATIVE import specifiers on disk (bare package
// specifiers, e.g. 'react' or 'firebase/database', are recorded but never
// followed onto disk) to build the real transitive dependency graph of a
// module — the archive-isolation guarantee ("no Firebase import, directly
// or transitively") is only actually verified by walking this graph, not
// by checking one file's own import list.
const collectTransitiveImports = (entryFile, visitedFiles = new Set(), bareSpecifiers = new Set()) => {
  const absEntry = path.resolve(entryFile);
  if (visitedFiles.has(absEntry)) return { visitedFiles, bareSpecifiers };
  visitedFiles.add(absEntry);
  const source = readFileSync(absEntry, 'utf8');
  importSpecifiers(source).forEach((spec) => {
    if (!spec.startsWith('.')) {
      bareSpecifiers.add(spec);
      return;
    }
    const resolved = path.resolve(path.dirname(absEntry), spec);
    if (/\.jsx?$/.test(resolved)) collectTransitiveImports(resolved, visitedFiles, bareSpecifiers);
  });
  return { visitedFiles, bareSpecifiers };
};

test('the archive page module never imports a Firebase/cloud-sync module', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/live/CanalettoArchive2026Page.jsx'), 'utf8');
  const imports = importSpecifiers(source);
  assert.ok(!imports.some((spec) => spec.includes('firebase')), 'CanalettoArchive2026Page.jsx must not import any firebase/ module');
  assert.ok(!imports.some((spec) => spec.includes('useCloudPublicEvent')), 'CanalettoArchive2026Page.jsx must not subscribe to the live cloud state');
});

// Archive isolation fix: LivescorePresentation.jsx was extracted out of
// LivescorePage.jsx (which owns the Firebase subscription) specifically so
// importing the presentation never transitively drags Firebase's module
// graph in. This walks the REAL dependency graph on disk rather than
// trusting a one-file import list, since ES module imports execute a
// file's entire top-level dependency graph — a one-level check would miss
// a transitive reintroduction.
test('CanalettoArchive2026Page.jsx imports LivescorePresentation.jsx directly, never through LivescorePage.jsx', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/live/CanalettoArchive2026Page.jsx'), 'utf8');
  const imports = importSpecifiers(source);
  assert.ok(imports.some((spec) => spec.includes('LivescorePresentation')), 'CanalettoArchive2026Page.jsx must import LivescorePresentation.jsx');
  assert.ok(!imports.some((spec) => spec.includes('LivescorePage')), 'CanalettoArchive2026Page.jsx must not import LivescorePage.jsx (the Firebase-subscribing wrapper)');
});

test('LivescorePresentation.jsx has no Firebase dependency anywhere in its transitive import graph', () => {
  const entry = path.join(__dirname, '../src/canaletto/live/LivescorePresentation.jsx');
  const { visitedFiles, bareSpecifiers } = collectTransitiveImports(entry);

  const firebaseSourceFiles = [...visitedFiles].filter((f) => /firebase|useCloudPublicEvent|canalettoCloudSync/i.test(f));
  assert.deepEqual(firebaseSourceFiles, [], `LivescorePresentation.jsx must not transitively reach: ${firebaseSourceFiles.join(', ')}`);

  const firebasePackages = [...bareSpecifiers].filter((spec) => spec.startsWith('firebase'));
  assert.deepEqual(firebasePackages, [], `LivescorePresentation.jsx must not transitively import the firebase package: ${firebasePackages.join(', ')}`);

  // Sanity: the walk actually traversed a non-trivial graph (ui.jsx,
  // koUi.jsx, canalettoEvent.js, etc.) — an empty/near-empty visitedFiles
  // set would mean the import-extraction regex silently failed to match
  // anything, making the assertions above vacuously true rather than real.
  assert.ok(visitedFiles.size > 5, 'expected LivescorePresentation.jsx to transitively reach several real modules');
});

test('the landing page module never imports a Firebase/cloud-sync module', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/live/CanalettoLandingPage.jsx'), 'utf8');
  const imports = importSpecifiers(source);
  assert.ok(!imports.some((spec) => spec.includes('firebase')), 'CanalettoLandingPage.jsx must not import any firebase/ module');
});

// ---------------------------------------------------------------------------
// App-entry isolation (FINAL STATIC-ARCHIVE STARTUP ISOLATION) — the real
// question is not "does any component call Firebase" (already proven for
// LivescorePresentation.jsx above) but "does the browser fetch/evaluate
// Firebase's module graph AT ALL just from loading main.jsx/App.jsx,
// regardless of which route renders." collectTransitiveImports() only
// follows STATIC `import ... from '...'` declarations (its regex requires
// a `from` clause) — a `lazy(() => import('...'))` call has no `from`
// clause, so the walker correctly stops there, exactly mirroring what a
// real bundler's eager-vs-chunk-boundary split does. This is therefore a
// genuine statically-verifiable proxy for "no Firebase in the eager
// bundle," not just a restatement of the component-purity check above.
// ---------------------------------------------------------------------------

test('App.jsx contains real dynamic-import() boundaries for the director and live/public branches', () => {
  const source = readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
  assert.ok(/lazy\(\s*\(\)\s*=>\s*import\(['"]\.\/canaletto\/CanalettoDirectorEntry\.jsx['"]\)\s*\)/.test(source), 'App.jsx must lazy-load CanalettoDirectorEntry.jsx via a real import() call');
  assert.ok(/lazy\(\s*\(\)\s*=>\s*import\(['"]\.\/canaletto\/live\/CanalettoLiveEntry\.jsx['"]\)\s*\)/.test(source), 'App.jsx must lazy-load CanalettoLiveEntry.jsx via a real import() call');
});

test('App.jsx\'s EAGER (static-only) import graph reaches no Firebase module and no firebase package', () => {
  const entry = path.join(__dirname, '../src/App.jsx');
  const { visitedFiles, bareSpecifiers } = collectTransitiveImports(entry);

  const firebaseSourceFiles = [...visitedFiles].filter((f) => /firebase|useFirebaseAuth|useCloudPublicEvent|canalettoCloudSync/i.test(f));
  assert.deepEqual(firebaseSourceFiles, [], `App.jsx's eager graph must not statically reach: ${firebaseSourceFiles.join(', ')}`);

  const firebasePackages = [...bareSpecifiers].filter((spec) => spec.startsWith('firebase'));
  assert.deepEqual(firebasePackages, [], `App.jsx's eager graph must not statically import the firebase package: ${firebasePackages.join(', ')}`);
});

test('App.jsx\'s eager graph does NOT statically reach the lazy-loaded director/live modules (proves the import() boundary actually isolates them)', () => {
  const entry = path.join(__dirname, '../src/App.jsx');
  const { visitedFiles } = collectTransitiveImports(entry);
  const visitedBasenames = [...visitedFiles].map((f) => path.basename(f));

  ['CanalettoDirectorEntry.jsx', 'CanalettoLiveEntry.jsx', 'CanalettoLiveRouter.jsx', 'LivescorePage.jsx', 'CanalettoApp.jsx', 'DirectorAuthGate.jsx'].forEach((name) => {
    assert.ok(!visitedBasenames.includes(name), `${name} must only be reachable through the lazy import() boundary, not App.jsx's eager static graph`);
  });
});

test('App.jsx\'s eager graph is non-trivial and really does include the archive/landing/routing modules', () => {
  const entry = path.join(__dirname, '../src/App.jsx');
  const { visitedFiles } = collectTransitiveImports(entry);
  const visitedBasenames = [...visitedFiles].map((f) => path.basename(f));

  ['CanalettoArchive2026Page.jsx', 'LivescorePresentation.jsx', 'CanalettoLandingPage.jsx', 'publicDomain.js', 'PoolTournamentApp.jsx', 'canalettoEvent.js', 'ui.jsx'].forEach((name) => {
    assert.ok(visitedBasenames.includes(name), `expected App.jsx's eager graph to include ${name}`);
  });
});

// ---------------------------------------------------------------------------
// URGENT ARCHITECTURE FIX ("bind OBS/live links to current director event")
// regression guard: introducing canalettoWorkspace/the new event-selector
// mapping must not touch the static archive or landing page at all — they
// have no event-namespace concept whatsoever, Firebase-backed or not.
// ---------------------------------------------------------------------------

test('the archive and landing pages never reference the event-namespace selector mechanism at all', () => {
  const archiveSource = readFileSync(path.join(__dirname, '../src/canaletto/live/CanalettoArchive2026Page.jsx'), 'utf8');
  const landingSource = readFileSync(path.join(__dirname, '../src/canaletto/live/CanalettoLandingPage.jsx'), 'utf8');
  [archiveSource, landingSource].forEach((source) => {
    assert.ok(!source.includes('canalettoCloudPaths'), 'must not reference canalettoCloudPaths.js');
    assert.ok(!/\bresolveEventSelector\b|\bCURRENT_EVENT_SELECTOR\b|\bCANALETTO_EVENT_ID\b/.test(source), 'must not reference the event-selector mechanism');
  });
});
