// React state ownership for the Canaletto UI: a thin wrapper around the pure
// src/application/canalettoEvent.js command functions, persisted to
// localStorage (offline MVP — see docs/DEPLOYMENT.md). This is the ONLY
// place Canaletto state is mutated from React; every actual state transition
// still happens inside the pure canalettoEvent.js functions.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCanalettoEvent, validateCanalettoEvent } from '../application/canalettoEvent.js';

const STORAGE_KEY = 'canaletto-event-v1';

const loadInitialEvent = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createCanalettoEvent();
    const parsed = JSON.parse(raw);
    const result = validateCanalettoEvent(parsed);
    if (!result.valid) {
      console.warn('Canaletto: stored event failed validation, starting fresh', result.errors);
      return createCanalettoEvent();
    }
    return parsed;
  } catch (e) {
    console.warn('Canaletto: could not restore stored event, starting fresh', e);
    return createCanalettoEvent();
  }
};

export const useCanalettoEvent = () => {
  const [event, setEvent] = useState(loadInitialEvent);
  const [error, setError] = useState(null);
  // Always mirrors the latest committed `event` — read by run() so a
  // command's success/failure can be determined synchronously (see below),
  // rather than depending on any React scheduling internal.
  const eventRef = useRef(event);
  eventRef.current = event;

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
  }, [event]);

  // Runs a canalettoEvent.js command against the current event, SYNCHRONOUSLY
  // (the command is a pure function called directly here, not deferred into
  // a setState updater), so callers can reliably branch on the returned
  // boolean in the same tick (e.g. "only navigate if the start succeeded").
  // Commands throw on invalid transitions (locked block, not-started block,
  // etc.) — caught here so a rejected action surfaces as a message instead
  // of crashing the UI, and the event is left completely unchanged on
  // failure.
  const run = useCallback((fn, ...args) => {
    try {
      const next = fn(eventRef.current, ...args);
      eventRef.current = next;
      setEvent(next);
      setError(null);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }, []);

  const resetEvent = useCallback(() => {
    const fresh = createCanalettoEvent();
    eventRef.current = fresh;
    setEvent(fresh);
    setError(null);
  }, []);

  return { event, run, error, clearError: () => setError(null), resetEvent };
};
