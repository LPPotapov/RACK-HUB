import { useState } from 'react';
import { ActionButton } from './ui.jsx';

// Generic Danger Zone confirmation: destructive actions are never one-click
// — the director must type an exact phrase before the confirm button
// enables (director correction pass, items 13/15/16).
export const TypedConfirmModal = ({ title, warning, phrase, confirmLabel, onConfirm, onClose }) => {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === phrase;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-lg rounded border-2 border-canaletto-magenta bg-canaletto-panel p-5">
        <div className="mb-2 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-magenta">Danger Zone</div>
        <h2 className="mb-3 font-condensed text-2xl font-black uppercase text-canaletto-cream">{title}</h2>
        <div className="mb-4 text-sm text-canaletto-lavender">{warning}</div>
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-canaletto-lavender">
          Type <span className="text-canaletto-magenta">{phrase}</span> to confirm
        </div>
        <input
          className="input mb-4 font-mono"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={phrase}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <ActionButton variant="outline" onClick={onClose}>Cancel</ActionButton>
          <ActionButton variant="magenta" disabled={!matches} onClick={() => { onConfirm(); onClose(); }}>
            {confirmLabel}
          </ActionButton>
        </div>
      </div>
    </div>
  );
};
