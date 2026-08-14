// Top-level dispatcher for every `?live=...` route (see App.jsx and
// liveLinks.js) — renders the matching public/OBS page with NO Sidebar/
// CanalettoApp director chrome around it, since these are meant to be
// opened as their own browser tabs/OBS Browser Sources.

import { BlockResultsOverlayPage } from './BlockResultsOverlayPage.jsx';
import { BracketOverlayPage } from './BracketOverlayPage.jsx';
import { LivescorePage } from './LivescorePage.jsx';
import { Top12OverlayPage } from './Top12OverlayPage.jsx';
import { TvOverlayPage } from './TvOverlayPage.jsx';
import { TvScoreControlPage } from './TvScoreControlPage.jsx';

const resolveBlock = (params) => (params.get('block') === 'B' ? 'B' : 'A');

export const CanalettoLiveRouter = ({ view, params }) => {
  switch (view) {
    case 'livescore':
      return <LivescorePage />;
    case 'tv-overlay':
      return <TvOverlayPage />;
    case 'tv-control':
      return <TvScoreControlPage />;
    case 'top12':
      return <Top12OverlayPage block={resolveBlock(params)} />;
    case 'block-results':
      return <BlockResultsOverlayPage block={resolveBlock(params)} />;
    case 'bracket':
      return <BracketOverlayPage />;
    default:
      return (
        <div className="flex min-h-screen items-center justify-center bg-canaletto-bg text-canaletto-lavender">
          Unknown LIVE view "{view}".
        </div>
      );
  }
};
