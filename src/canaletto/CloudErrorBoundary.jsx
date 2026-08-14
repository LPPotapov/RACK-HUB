// Narrow defense-in-depth error boundary around CloudSyncPanel.jsx
// (fresh-empty-tournament hotfix, item 5 — "Cloud sync must never take
// down tournament direction"). This does NOT catch the exception that
// actually caused the reported white screen — that lived in
// Sidebar.jsx/EventPage.jsx's own unconditional getTop16Status(event)
// calls, outside anything this boundary wraps — the real fix for that is
// canalettoCloudCodec.js decoding a complete, never-partially-absent
// event shape (see that file's header). This boundary exists as backstop
// for a DIFFERENT class of failure: an unexpected exception inside
// CloudSyncPanel's OWN rendering (a future bug, a Firebase SDK surprise,
// etc.) — it must never be able to blank the rest of the director app
// (EventPage's block cards, settings, or Sidebar navigation) even if
// something inside the cloud-sync UI itself breaks.
//
// A plain class component — React error boundaries have no Hooks
// equivalent.

import { Component } from 'react';

export class CloudErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.warn('Canaletto cloud sync: CloudSyncPanel crashed, isolated by CloudErrorBoundary', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mb-4 rounded border border-canaletto-magenta/60 bg-canaletto-magenta/10 px-3 py-2 text-xs font-semibold text-canaletto-magenta">
          Cloud Sync Error — tournament direction continues normally, unaffected.
        </div>
      );
    }
    return this.props.children;
  }
}
