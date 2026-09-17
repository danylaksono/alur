import { useEffect, useRef, useState } from 'react';
import { createProjectManifest } from '../services/projectService';
import {
  deleteRecoverySnapshot,
  latestRecoverySnapshot,
  saveRecoverySnapshot,
  type RecoverySnapshot,
} from '../services/recoveryStorage';
import { useStore } from '../store/useStore';

const AUTOSAVE_DELAY_MS = 900;
const SESSION_KEY = 'alur-session';

/** A snapshot plus whether this tab should pick it up without asking. */
export type RecoveryCandidate = RecoverySnapshot & { resume: boolean };

/**
 * An id for this browser tab. sessionStorage survives a reload and a tab
 * discard but never reaches a new tab, which is exactly the line between
 * "I came back to my work" and "I opened ALUR fresh".
 *
 * Returns '' where storage is blocked (private mode, cookies off). Callers
 * must treat that as "cannot tell" and prompt, never as a match.
 */
const tabSessionId = () => {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return '';
  }
};

/** Not in lib.dom yet; set by Chromium when a discarded tab is reopened. */
const wasDiscarded = () => (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true;

/**
 * Whether to pick a snapshot up without asking. An empty session means storage
 * is blocked and nothing can be concluded, so it must never match a snapshot
 * that also carries no session.
 */
export const shouldResume = (snapshot: RecoverySnapshot, session: string, discarded: boolean) =>
  (Boolean(session) && snapshot.sessionId === session) || discarded;

export const useProjectRecovery = () => {
  const duckdbReady = useStore((state) => state.duckdbReady);
  const hasWork = useStore((state) => state.nodes.length > 0 || state.mapLayers.length > 0);
  const setRecoverySave = useStore((state) => state.setRecoverySave);
  const [candidate, setCandidate] = useState<RecoveryCandidate | null>(null);
  const checkedRecovery = useRef(false);

  useEffect(() => {
    let timeout: number | undefined;
    let pending = false;
    let lastSerialised = '';
    const save = () => {
      window.clearTimeout(timeout);
      pending = false;
      const snapshot = createProjectManifest(useStore.getState());
      void saveRecoverySnapshot(snapshot, tabSessionId())
        .then((saved) => setRecoverySave({ status: 'saved', savedAt: saved.createdAt }))
        .catch(() => setRecoverySave({ status: 'error' }));
    };
    const schedule = () => {
      const state = useStore.getState();
      if (!state.nodes.length && !state.mapLayers.length) return;
      const manifest = createProjectManifest(state);
      const serialised = JSON.stringify({ ...manifest, exportedAt: '' });
      if (serialised === lastSerialised) return;
      lastSerialised = serialised;
      window.clearTimeout(timeout);
      pending = true;
      setRecoverySave({ status: 'saving' });
      timeout = window.setTimeout(save, AUTOSAVE_DELAY_MS);
    };
    // A backgrounded tab can be discarded at any moment, so the debounce
    // window is exactly where an edit goes missing. Hiding is the last
    // reliable moment to spend it.
    const flush = () => {
      if (pending && document.visibilityState === 'hidden') save();
    };
    schedule();
    const unsubscribe = useStore.subscribe(schedule);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
      document.removeEventListener('visibilitychange', flush);
    };
  }, [setRecoverySave]);

  useEffect(() => {
    if (!duckdbReady || checkedRecovery.current) return;
    checkedRecovery.current = true;
    if (hasWork) return;
    void latestRecoverySnapshot(tabSessionId()).then((snapshot) => {
      if (!snapshot) return;
      // Same tab as the one that wrote it means a return to work in progress
      // rather than a cold start, and asking only gets in the way.
      setCandidate({ ...snapshot, resume: shouldResume(snapshot, tabSessionId(), wasDiscarded()) });
    }).catch(() => undefined);
  }, [duckdbReady, hasWork]);

  const discard = async () => {
    if (candidate) await deleteRecoverySnapshot(candidate.id).catch(() => undefined);
    setCandidate(null);
  };

  return { candidate, setCandidate, discard };
};
