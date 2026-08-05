import { OperationError } from '../operation-error.ts';
import type { MutationOperation, Operation, TransactionOperation } from '../operation-error.ts';
import { TransactionError } from '../transaction-error.ts';
import type { TransactionErrorCode } from '../transaction-error.ts';

describe('TransactionError', () => {
  it('задаёт stable transaction boundary messages', () => {
    const errors = [
      new TransactionError('invalid-scope', 'client.transaction'),
      new TransactionError('table-not-in-scope', 'transaction.select'),
      new TransactionError('inactive', 'transaction.select'),
      new TransactionError('premature-commit', 'client.transaction'),
      new TransactionError('start-failed', 'client.transaction'),
      new TransactionError('commit-failed', 'client.transaction'),
      new TransactionError('aborted', 'client.transaction'),
    ];

    expect(errors.map(({ code, message }) => [code, message])).toEqual([
      ['invalid-scope', 'Transaction scope is invalid'],
      ['table-not-in-scope', 'Table is not part of the transaction scope'],
      ['inactive', 'Transaction is no longer active'],
      ['premature-commit', 'Transaction committed before the callback completed'],
      ['start-failed', 'Transaction could not be started'],
      ['commit-failed', 'Transaction could not be committed'],
      ['aborted', 'Transaction was aborted'],
    ]);

    for (const error of errors) {
      expect(error).toBeInstanceOf(OperationError);
      expect(error.name).toBe('TransactionError');
    }
  });

  it('сохраняет physical cause только как unknown по identity', () => {
    const cause = new DOMException('Physical details', 'UnknownError');
    const error = new TransactionError('start-failed', 'client.transaction', {
      cause,
    });

    expectTypeOf(error.code).toEqualTypeOf<TransactionErrorCode>();
    expectTypeOf(error.operation).toEqualTypeOf<Operation>();
    expectTypeOf(error.cause).toEqualTypeOf<unknown>();
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain(cause.message);
  });

  it('ограничивает code-operation combinations compile-time', () => {
    expectTypeOf<TransactionOperation>().toEqualTypeOf<
      | 'transaction.select'
      | 'transaction.insert'
      | 'transaction.upsert'
      | 'transaction.update'
      | 'transaction.delete'
    >();

    const assertTypeErrors = (): void => {
      const operation = null as unknown as MutationOperation;

      new TransactionError('inactive', operation);

      // @ts-expect-error table membership относится только к transaction operation.
      new TransactionError('table-not-in-scope', 'select.getRawOne');
      // @ts-expect-error boundary failure относится только к client.transaction.
      new TransactionError('commit-failed', 'transaction.select');
      // @ts-expect-error inactive не описывает client transaction orchestration.
      new TransactionError('inactive', 'client.transaction');
    };
    void assertTypeErrors;

    expect(true).toBe(true);
  });
});
