import { getBlockStatus, getTop16Status } from '../application/canalettoEvent.js';
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

export const Sidebar = ({ event, page, onNavigate }) => (
  <aside className="flex w-56 shrink-0 flex-col border-r border-canaletto-border bg-canaletto-panel">
    <div className="flex items-center gap-2 border-b border-canaletto-border px-4 py-4">
      <img src={batforceLogo} alt="Batforce" className="h-9 w-9 shrink-0 object-contain" />
      <div>
        <div className="font-condensed text-lg font-black uppercase leading-none tracking-wide text-canaletto-cream">Canaletto</div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-canaletto-lavender">Tournament Director</div>
      </div>
    </div>

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

    <div className="border-t border-canaletto-border px-4 py-3">
      <a
        href="?legacy=1"
        className="text-[11px] font-semibold uppercase tracking-wider text-canaletto-lavender/70 hover:text-canaletto-lavender"
      >
        Legacy UI Fallback
      </a>
    </div>
  </aside>
);
