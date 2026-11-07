// Canaletto Cup archive/event-selector landing page — canaletto.bc-joes.de
// root (see docs task "CANALETTO CUP — LANDING PAGE + TRUE 2026 STATIC
// ARCHIVE"). NOT a tournament dashboard: no Firebase, no director chrome,
// no login, just a static list of archived events linking to each one's
// own route. Adding a future year (e.g. 2027) is adding one entry to
// CANALETTO_ARCHIVES below — nothing else on this page changes.
import { CANALETTO_PUBLIC_EVENT_TITLE } from '../publicDomain.js';

const CANALETTO_ARCHIVES = [{ year: 2026, title: CANALETTO_PUBLIC_EVENT_TITLE, path: '/2026', status: 'COMPLETED' }];

// A plain `<a>` to a clean internal path — the browser's own navigation
// to that path (served by Firebase Hosting's catch-all SPA rewrite, see
// firebase.json) is not a redirect and keeps the address bar exactly as
// typed; no client-side router is needed for one link.
const ArchiveCard = ({ archive }) => (
  <a
    href={archive.path}
    className="block rounded border-2 border-canaletto-gold bg-canaletto-gold/10 px-6 py-5 text-center transition hover:bg-canaletto-gold/20"
  >
    <div className="break-words font-condensed text-2xl font-black uppercase tracking-tight text-canaletto-gold sm:text-3xl">
      {archive.title}
    </div>
    <div className="mt-2 text-xs font-bold uppercase tracking-widest text-canaletto-lavender sm:text-sm">Status: {archive.status}</div>
  </a>
);

export const CanalettoLandingPage = () => (
  <div className="flex min-h-dvh flex-col items-center bg-canaletto-bg px-4 py-10 text-canaletto-cream sm:py-16">
    <div className="w-full max-w-xl text-center">
      <h1 className="break-words font-condensed text-4xl font-black uppercase leading-tight tracking-tight text-canaletto-cream sm:text-6xl">
        Canaletto Cup
      </h1>
      <div className="mt-2 text-sm font-bold uppercase tracking-widest text-canaletto-lavender sm:text-base">Tournament Archive</div>
      <div className="mt-10 space-y-4">
        {CANALETTO_ARCHIVES.map((archive) => (
          <ArchiveCard key={archive.year} archive={archive} />
        ))}
      </div>
    </div>
  </div>
);
