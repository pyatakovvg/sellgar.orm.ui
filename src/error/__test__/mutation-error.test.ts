import { MutationError, OperationError } from '../index.ts';
import type { MutationErrorCode, MutationOperation, Operation } from '../index.ts';

describe('MutationError', () => {
  it('задаёт стабильные ошибки изменения данных', () => {
    const cause = new DOMException('private physical details', 'UnknownError');
    const errors = [
      new MutationError('constraint-violation', 'insert.execute', { cause }),
      new MutationError('invalid-key', 'upsert.execute', { cause }),
      new MutationError('record-not-cloneable', 'upsert.execute', { cause }),
      new MutationError('quota-exceeded', 'insert.execute', { cause }),
      new MutationError('transaction-aborted', 'delete.execute', { cause }),
      new MutationError('operation-failed', 'update.execute', { cause }),
    ];

    expectTypeOf(errors[0].code).toEqualTypeOf<MutationErrorCode>();
    expectTypeOf(errors[0].operation).toEqualTypeOf<Operation>();
    expect(errors.map(({ code, message }) => [code, message])).toEqual([
      ['constraint-violation', 'A table constraint was violated'],
      ['invalid-key', 'The table key is invalid'],
      ['record-not-cloneable', 'The record cannot be cloned for storage'],
      ['quota-exceeded', 'The storage quota was exceeded'],
      ['transaction-aborted', 'The table transaction was aborted'],
      ['operation-failed', 'The table operation failed'],
    ]);

    for (const error of errors) {
      expect(error).toBeInstanceOf(OperationError);
      expect(error.name).toBe('MutationError');
      expect(error.cause).toBe(cause);
      expect(error.message).not.toContain(cause.message);
    }
  });

  it('ограничивает операции изменениями данных', () => {
    const operations: MutationOperation[] = [
      'insert.execute',
      'upsert.execute',
      'update.execute',
      'delete.execute',
    ];

    if (false) {
      const cause = new Error('physical failure');

      // @ts-expect-error чтение не является mutation operation.
      new MutationError('operation-failed', 'select.getRawOne', { cause });
      // @ts-expect-error public client method не является выполненной mutation.
      new MutationError('operation-failed', 'client.insert', { cause });
    }

    expect(operations).toHaveLength(4);
  });
});
