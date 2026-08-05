import { MutationError, QueryError } from '../../../../error/index.ts';
import { mapMutationError } from '../index.ts';

describe('mapMutationError', () => {
  it.each([
    ['ConstraintError', 'constraint-violation'],
    ['DataError', 'invalid-key'],
    ['DataCloneError', 'record-not-cloneable'],
    ['QuotaExceededError', 'quota-exceeded'],
    ['AbortError', 'transaction-aborted'],
  ] as const)('преобразует %s в стабильную mutation error', (name, code) => {
    const cause = new DOMException('private physical details', name);
    const error = mapMutationError('upsert.execute', cause);

    expect(error).toBeInstanceOf(MutationError);
    expect(error).toMatchObject({
      name: 'MutationError',
      code,
      operation: 'upsert.execute',
    });
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain(cause.message);
  });

  it('оставляет логическую ошибку планировщика без повторного маппинга', () => {
    const cause = new QueryError('scan-required', 'delete.execute');

    expect(mapMutationError('delete.execute', cause)).toBe(cause);
  });

  it('преобразует неизвестную причину в operation-failed', () => {
    const cause = 'unknown physical value';
    const error = mapMutationError('update.execute', cause);

    expect(error).toMatchObject({
      name: 'MutationError',
      code: 'operation-failed',
      operation: 'update.execute',
    });
    expect(error.cause).toBe(cause);
  });
});
