import { describe, expect, it } from 'vitest';
import { retainNewestSnapshots, type RecoverySnapshot } from './recoveryStorage';

describe('recoveryStorage', () => {
  it('keeps only the newest rolling recovery snapshots', () => {
    const snapshots = Array.from({ length: 7 }, (_, index) => ({ id: String(index), createdAt: index, manifest: {} })) as RecoverySnapshot[];
    expect(retainNewestSnapshots(snapshots).map((item) => item.id)).toEqual(['6', '5', '4', '3', '2']);
  });
});

