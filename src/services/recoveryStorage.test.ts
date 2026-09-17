import { describe, expect, it } from 'vitest';
import { retainNewestSnapshots, type RecoverySnapshot } from './recoveryStorage';

const row = (id: string, createdAt: number) => ({ id, createdAt, sessionId: id, manifest: {} }) as unknown as RecoverySnapshot;

describe('recoveryStorage', () => {
  it('keeps the most recently active tabs and drops the rest', () => {
    const snapshots = Array.from({ length: 7 }, (_, index) => row(String(index), index));
    expect(retainNewestSnapshots(snapshots).map((item) => item.id)).toEqual(['6', '5', '4']);
  });

  it('never trims a tab below its one row, however many tabs are open', () => {
    // Each tab owns a single row, so a busy tab cannot crowd out a quiet one.
    const busy = row('busy', 100);
    const quiet = row('quiet', 1);
    expect(retainNewestSnapshots([busy, quiet], 3).map((item) => item.id)).toEqual(['busy', 'quiet']);
  });
});
