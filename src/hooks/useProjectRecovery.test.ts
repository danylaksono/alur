import { describe, expect, it } from 'vitest';
import { shouldResume } from './useProjectRecovery';
import type { RecoverySnapshot } from '../services/recoveryStorage';

const snapshot = (sessionId?: string) =>
  ({ id: 'r1', createdAt: 1, manifest: {}, sessionId }) as unknown as RecoverySnapshot;

describe('shouldResume', () => {
  it('resumes a snapshot this tab wrote', () => {
    expect(shouldResume(snapshot('tab-a'), 'tab-a', false)).toBe(true);
  });

  it('asks about a snapshot from another tab or an earlier visit', () => {
    expect(shouldResume(snapshot('tab-a'), 'tab-b', false)).toBe(false);
    expect(shouldResume(snapshot(undefined), 'tab-b', false)).toBe(false);
  });

  it('asks rather than guesses when session storage is unavailable', () => {
    expect(shouldResume(snapshot(undefined), '', false)).toBe(false);
    expect(shouldResume(snapshot(''), '', false)).toBe(false);
  });

  it('resumes a discarded tab even without a session match', () => {
    expect(shouldResume(snapshot('tab-a'), '', true)).toBe(true);
  });
});
