// Small shared pieces reused across the LIVE/public/OBS pages — deliberately
// thin wrappers over the SAME already-approved, already-tested display
// components the director app uses (ui.jsx's StandingsTable, koUi.jsx's
// BracketOverview, etc.), never a second implementation of standings/
// bracket/match-card rendering. Public pages compose these; they add no
// data logic of their own.

import batforceLogo from '../../assets/batforce_orange_logo.png';
import { splitForTwoColumnDisplay } from '../layout.js';
import { StandingsTable } from '../ui.jsx';
import { OVERLAY_PANEL_CLASS, OVERLAY_SHELL_OUTER_CLASS } from './overlayShell.js';

// Shared shell for the full-size Results/bracket OBS overlays (director
// correction pass items 5/6) — transparent outer page, large centered
// translucent Canaletto panel. `maxWidth` is a Tailwind max-w-* class so
// each overlay keeps its own natural width (bracket is wider than a 2-col
// results table) without duplicating the shell classes themselves.
export const OverlayShell = ({ maxWidth = 'max-w-[1400px]', children }) => (
  <div className={OVERLAY_SHELL_OUTER_CLASS}>
    <div className={`${OVERLAY_PANEL_CLASS} ${maxWidth}`}>{children}</div>
  </div>
);

// Shared header for the full-size Results/bracket OBS overlays (director
// correction pass item 3 — "move the logo to the LEFT side of the overlay
// header", not centered/right). Logo pinned to the left edge, event
// title/eyebrow left-aligned right next to it — never a centered pair.
export const OverlayHeader = ({ eyebrow, title }) => (
  <div className="mb-6 flex items-center gap-4">
    <LiveBrandMark className="h-12 w-12 shrink-0" />
    <div className="text-left">
      <div className="font-condensed text-xs font-bold uppercase tracking-[0.2em] text-canaletto-magenta">{eyebrow}</div>
      <div className="font-condensed text-4xl font-black uppercase tracking-tight text-canaletto-cream">{title}</div>
    </div>
  </div>
);

// ONE continuous ranking split into two visual columns — identical pattern
// to BlockPage.jsx's own (private) TwoColumnStandings, extracted here so
// the public Livescore/Block-Results-overlay pages can share it too instead
// of duplicating the split-and-render logic a third time.
export const TwoColumnStandings = ({ rows, qualificationThreshold }) => {
  const [left, right] = splitForTwoColumnDisplay(rows);
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <StandingsTable players={left} qualificationThreshold={qualificationThreshold} />
      <StandingsTable players={right} qualificationThreshold={qualificationThreshold} />
    </div>
  );
};

// Small branding mark for LIVE/public/overlay pages (director correction —
// "Use the Batforce logo... instead of the orange BBS box where
// appropriate in the LIVE/overlay views"). Plain <img>, no text fallback
// box — these pages are broadcast-facing, not the operator sidebar.
export const LiveBrandMark = ({ className = 'h-8 w-8' }) => (
  <img src={batforceLogo} alt="Batforce" className={`${className} object-contain`} />
);
