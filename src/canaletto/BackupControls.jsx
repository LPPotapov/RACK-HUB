// Offline tournament backup/restore controls (director-only — NEVER
// rendered on a public/OBS `?live=` route; only imported from
// src/canaletto/pages/*.jsx, the director app's own pages). Two pieces:
//   - SaveBackupButton — a single compact "Save Backup" button (Block
//     Results / Top16 pages — fast emergency use).
//   - BackupDataPanel — the fuller "Backup / Data" control (Event page):
//     Save + Restore, the latter gated behind file validation and a typed
//     confirmation, since restoring REPLACES the entire tournament.
//
// Both always save the FULL authoritative CanalettoEvent (see
// application/canalettoBackup.js) regardless of which page triggered the
// save — never just the currently-visible block/table.

import { useRef, useState } from 'react';
import { getBlockStatus, getCurrentKoStage, getKoChampion } from '../application/canalettoEvent.js';
import {
  buildBackupFilename,
  createCanalettoBackup,
  restoreCanalettoEvent,
  validateCanalettoBackup
} from '../application/canalettoBackup.js';
import { KO_STAGE_LABEL } from '../application/canalettoKo.js';
import { CANALETTO_LIVE_STORAGE_KEY } from './useCanalettoLiveState.js';
import { ActionButton, Panel } from './ui.jsx';
import { TypedConfirmModal } from './TypedConfirmModal.jsx';

// Best-effort, read-only: the broadcast/TV-selection state is optional
// extra context in a backup (docs task item 3 — "if safe/useful"), never
// required for a valid backup or for restore. Any problem reading/parsing
// it just means the backup omits it, never a save failure.
const readStoredLiveState = () => {
  try {
    const raw = window.localStorage.getItem(CANALETTO_LIVE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const downloadJson = (filename, data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// SAVE is read-only end to end: createCanalettoBackup() only reads `event`
// (never mutates it — see that function's own comment), and this never
// calls `run()`/any command, so it cannot advance a round, lock a block, or
// change any result/GBR/TV-selection as a side effect of exporting (docs
// task item 10).
const saveBackupFile = (event, source) => {
  const backup = createCanalettoBackup(event, { source, liveState: readStoredLiveState() });
  downloadJson(buildBackupFilename(event.settings?.title), backup);
};

// Compact single-button save — offered on Block A/B Results and the Top16
// page for fast emergency use (docs task item 11), always saving the FULL
// event regardless of which page it's clicked from.
export const SaveBackupButton = ({ event, source, className = 'px-3 py-1 text-xs' }) => (
  <ActionButton variant="outline" className={className} onClick={() => saveBackupFile(event, source)}>
    Save Backup
  </ActionButton>
);

const koStatusLabel = (event) => {
  if (getKoChampion(event)) return 'Complete';
  const stage = getCurrentKoStage(event);
  return stage ? `${KO_STAGE_LABEL[stage]} in progress` : 'Not started';
};

const RESTORE_PHRASE = 'RESTORE TOURNAMENT';

// The fuller "Backup / Data" control (Event page) — Save (same as
// SaveBackupButton) plus Restore. Restore is a three-step gate (docs task
// items 7/8): (1) parse+validate the chosen file, showing a clear rejection
// message and touching NOTHING if it fails; (2) show a summary of what's
// about to replace the current tournament; (3) require typing
// "RESTORE TOURNAMENT" — only an exact match calls restoreCanalettoEvent()
// via the app's normal run() command path (REPLACE semantics, never merge).
export const BackupDataPanel = ({ event, run, source = 'event' }) => {
  const [open, setOpen] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [pendingBackup, setPendingBackup] = useState(null); // validated, parsed backup file
  const fileInputRef = useRef(null);

  const handleFileChosen = (file) => {
    if (!file) return;
    setRestoreError(null);
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        setRestoreError('Selected file is not valid JSON.');
        return;
      }
      const result = validateCanalettoBackup(parsed);
      if (!result.valid) {
        setRestoreError(`Not a valid Canaletto tournament backup:\n${result.errors.join('\n')}`);
        return;
      }
      setPendingBackup(parsed);
    };
    reader.onerror = () => setRestoreError('Could not read the selected file.');
    reader.readAsText(file);
  };

  return (
    <div className="mb-4">
      <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={() => setOpen((o) => !o)}>
        Backup / Data
      </ActionButton>

      {open && (
        <Panel title="Backup / Data" accent="magenta" compact className="mt-2 max-w-md">
          <div className="mb-3 text-xs text-canaletto-lavender">
            Save an offline safety copy of the FULL tournament (both blocks, KO bracket, tables, settings) independent of browser storage — or restore one.
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={() => saveBackupFile(event, source)}>
              Save Tournament Backup
            </ActionButton>
            <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={() => fileInputRef.current?.click()}>
              Restore Backup
            </ActionButton>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                handleFileChosen(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {restoreError && (
            <div className="mt-2 whitespace-pre-line text-xs text-canaletto-magenta">{restoreError}</div>
          )}
        </Panel>
      )}

      {pendingBackup && (
        <TypedConfirmModal
          title="Restore Tournament Backup"
          warning={
            <div>
              <div className="mb-2">
                This REPLACES the entire current tournament — both blocks, the KO bracket, tables, and settings — with the backup below. The current state is not merged or kept; this cannot be undone.
              </div>
              <div className="rounded border border-canaletto-border bg-canaletto-panel2 p-2 text-xs text-canaletto-cream">
                <div>Backup saved: {pendingBackup.exportedAt ? new Date(pendingBackup.exportedAt).toLocaleString() : 'unknown'}</div>
                <div>Block A: {getBlockStatus(pendingBackup.event, 'A')}</div>
                <div>Block B: {getBlockStatus(pendingBackup.event, 'B')}</div>
                <div>KO: {koStatusLabel(pendingBackup.event)}</div>
              </div>
            </div>
          }
          phrase={RESTORE_PHRASE}
          confirmLabel="Restore"
          onConfirm={() => run(restoreCanalettoEvent, pendingBackup.event)}
          onClose={() => setPendingBackup(null)}
        />
      )}
    </div>
  );
};
