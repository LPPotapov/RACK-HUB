import { getBlockStatus, getTop16Status } from '../application/canalettoEvent.js';
import { IS_TEST_EVENT } from '../firebase/canalettoCloudPaths.js';
import batforceLogo from '../assets/batforce_orange_logo.png';

const NAV_ITEMS = [
  { id: 'event', label: 'Event', code: 'EV' },
  { id: 'players', label: 'Players', code: 'PL' },
  { id: 'blockA', label: 'Block A', code: 'A' },
  { id: 'blockB', label: 'Block B', code: 'B' },
  { id: 'top16', label: 'Top 16', code: '16' },
  { id: 'live', label: 'Live', code: 'LV' }
];

const DOT_STYLES = {
  NOT_STARTED: 'bg-canaletto-lavender/40',
  RUNNING: 'bg-canaletto-magenta',
  LOCKED: 'bg-canaletto-gold',
  READY: 'bg-canaletto-gold',
  WAITING_FOR_A: 'bg-canaletto-lavender/40',
  WAITING_FOR_B: 'bg-canaletto-lavender/40',
  WAITING_FOR_BOTH: 'bg-canaletto-lavender/40'
};

const statusForNav = (event, id) => {
  if (id === 'blockA') return getBlockStatus(event, 'A');
  if (id === 'blockB') return getBlockStatus(event, 'B');
  if (id === 'top16') return getTop16Status(event);
  return null;
};

export const Sidebar = ({ event, page, onNavigate, cloudAuth }) => (
  <aside className="flex w-56 shrink-0 flex-col border-r border-canaletto-border bg-canaletto-panel">
    <div className="flex items-center gap-2 border-b border-canaletto-border px-4 py-4">
      <img src={batforceLogo} alt="Batforce" className="h-9 w-9 shrink-0 object-contain" />
      <div>
        <div className="font-condensed text-lg font-black uppercase leading-none tracking-wide text-canaletto-cream">Canaletto</div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-canaletto-lavender">Tournament Director</div>
      </div>
    </div>

    {/* Urgent testing-feature hotfix — a very obvious, impossible-to-miss
        marker that this session is pointed at the ISOLATED canalettoTest
        Firebase namespace, never production. Only ever renders when the
        URL explicitly carried `event=test` (see canalettoCloudPaths.js's
        IS_TEST_EVENT — the ONE place this is decided). */}
    {IS_TEST_EVENT && (
      <div className="border-b border-canaletto-magenta bg-canaletto-magenta px-4 py-1.5 text-center font-condensed text-xs font-black uppercase tracking-widest text-white">
        Test Event
      </div>
    )}

    {/* Always-visible, impossible-to-miss sync status (urgent director-
        cloud fix — "make sure the UI clearly identifies that the director
        is LOCAL ONLY / WORKSPACE NOT PUBLISHED"). CloudSyncPanel's own
        "Cloud Empty" messaging already explains this correctly, but it's
        INSIDE a collapsed panel the director has to click open on
        EventPage.jsx — a director who never opens it had no way to tell,
        from any OTHER page, whether OBS/live links are actually seeing
        their current tournament. Mirrors the IS_TEST_EVENT banner's
        "impossible to miss" placement directly above. Only rendered once
        actually signed in as an authorized director — before that there
        is no cloud involvement to report at all, same as before this
        fix. */}
    {cloudAuth?.user && cloudAuth.isDirector && (
      <div
        className={`border-b px-4 py-1.5 text-center font-condensed text-xs font-black uppercase tracking-widest ${
          cloudAuth.syncMode === 'active'
            ? 'border-canaletto-gold bg-canaletto-gold text-black'
            : 'border-canaletto-magenta bg-canaletto-magenta text-white'
        }`}
      >
        {cloudAuth.syncMode === 'active' ? 'Live — Syncing To Cloud' : 'Local Only — Not Published'}
      </div>
    )}

    <nav className="flex-1 py-3">
      {NAV_ITEMS.map((item) => {
        const status = statusForNav(event, item.id);
        const active = page === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`flex w-full items-center gap-2 border-l-2 px-4 py-2.5 text-left font-condensed text-sm font-bold uppercase tracking-wide transition ${
              active
                ? 'border-canaletto-gold bg-canaletto-panel2 text-canaletto-gold'
                : 'border-transparent text-canaletto-lavender hover:bg-canaletto-panel2 hover:text-canaletto-cream'
            }`}
          >
            <span className="flex h-5 w-6 items-center justify-center rounded bg-canaletto-panel2 text-[10px] text-canaletto-lavender">
              {item.code}
            </span>
            <span className="flex-1">{item.label}</span>
            {status && <span className={`h-2 w-2 rounded-full ${DOT_STYLES[status]}`} />}
          </button>
        );
      })}
    </nav>

    <div className="space-y-1.5 border-t border-canaletto-border px-4 py-3">
      <a
        href="?legacy=1"
        className="block text-[11px] font-semibold uppercase tracking-wider text-canaletto-lavender/70 hover:text-canaletto-lavender"
      >
        Legacy UI Fallback
      </a>
      {cloudAuth?.user && (
        <button
          type="button"
          onClick={cloudAuth.signOut}
          className="block text-[11px] font-semibold uppercase tracking-wider text-canaletto-lavender/70 hover:text-canaletto-magenta"
        >
          Sign Out{cloudAuth.user.email ? ` (${cloudAuth.user.email})` : ''}
        </button>
      )}
    </div>
  </aside>
);
