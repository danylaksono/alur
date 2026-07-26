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

export const useProjectRecovery = () => {
  const duckdbReady = useStore((state) => state.duckdbReady);
  const hasWork = useStore((state) => state.nodes.length > 0 || state.mapLayers.length > 0);
  const setRecoverySave = useStore((state) => state.setRecoverySave);
  const [candidate, setCandidate] = useState<RecoverySnapshot | null>(null);
  const checkedRecovery = useRef(false);

  useEffect(() => {
    let timeout: number | undefined;
    let lastSerialised = '';
    const schedule = () => {
      const state = useStore.getState();
      if (!state.nodes.length && !state.mapLayers.length) return;
      const manifest = createProjectManifest(state);
      const serialised = JSON.stringify({ ...manifest, exportedAt: '' });
      if (serialised === lastSerialised) return;
      lastSerialised = serialised;
      window.clearTimeout(timeout);
      setRecoverySave({ status: 'saving' });
      timeout = window.setTimeout(() => {
        const snapshot = createProjectManifest(useStore.getState());
        void saveRecoverySnapshot(snapshot)
          .then((saved) => setRecoverySave({ status: 'saved', savedAt: saved.createdAt }))
          .catch(() => setRecoverySave({ status: 'error' }));
      }, AUTOSAVE_DELAY_MS);
    };
    schedule();
    const unsubscribe = useStore.subscribe(schedule);
    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, [setRecoverySave]);

  useEffect(() => {
    if (!duckdbReady || checkedRecovery.current) return;
    checkedRecovery.current = true;
    if (hasWork) return;
    void latestRecoverySnapshot().then(setCandidate).catch(() => undefined);
  }, [duckdbReady, hasWork]);

  const discard = async () => {
    if (candidate) await deleteRecoverySnapshot(candidate.id).catch(() => undefined);
    setCandidate(null);
  };

  return { candidate, setCandidate, discard };
};
