// Shared OBS overlay-shell classes (director correction pass items 5/6) —
// the full-size Results/bracket overlays must render as OBS overlays: a
// transparent outer page background with stream footage visible around a
// large, semi-opaque, centered/positioned Canaletto panel — never an opaque
// full-canvas dark background that looks like a standalone page.
//
// Plain string constants (not JSX) so the "outer background stays
// transparent, panel stays semi-opaque" contract can be verified by a
// pure-data test without a component-rendering harness (this repo's test
// runner is plain `node --test`, no JSX/DOM support) — see
// tests/canaletto-live.test.js.
export const OVERLAY_SHELL_OUTER_CLASS = 'min-h-screen w-full bg-transparent flex items-center justify-center p-6';

// Semi-opaque panel background (not solid), border, restrained shadow —
// readability without becoming an opaque full-screen page.
export const OVERLAY_PANEL_CLASS = 'w-full rounded-lg border border-canaletto-gold/40 bg-canaletto-panel/90 px-10 py-8 shadow-2xl text-canaletto-cream';
