# RACK HUB

RACK HUB is tournament-management software implementing the Batforce
Billiards System (BBS Engine).

## Local development

```bash
npm install
npm run dev
```

This starts a local dev server (default: http://localhost:5173).

## Production build

```bash
npm run build
```

Output is written to `dist/`.

## Project layout

- `legacy/` — the reference legacy tournament application (unmodified).
- `docs/` — the BBS whitepaper (specification for stable fixed-rack BBS behavior).
- `src/` — the Vite + React application. `src/PoolTournamentApp.jsx` is an
  unmodified copy of the legacy app's component, wired up to run under Vite.
