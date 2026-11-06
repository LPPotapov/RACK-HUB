// Single source of truth for detecting the public Canaletto Cup 2026
// custom domain (canaletto.bc-joes.de). Shared between App.jsx's routing
// default (root -> Livescore) and any public page needing hostname-gated
// presentation (e.g. LivescorePage's large event-identity heading) — the
// director app's own host (rack-hub-canaletto.web.app) must never match.
export const CANALETTO_PUBLIC_HOSTNAME = 'canaletto.bc-joes.de';

export const isCanalettoPublicDomain = () => window.location.hostname === CANALETTO_PUBLIC_HOSTNAME;
