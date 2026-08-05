import { OperationError, QueryError } from '../index.ts';
import type { QueryErrorCode } from '../index.ts';

describe('QueryError', () => {
  it('задаёт stable boundary errors без cause', () => {
    const scan = new QueryError('scan-required', 'select.getRawMany');
    const order = new QueryError('unsupported-order', 'select.getRawMany');
    const table = new QueryError('table-not-in-schema', 'select.getRawMany');

    expect(scan).toBeInstanceOf(OperationError);
    expect(scan).toBeInstanceOf(QueryError);
    expect(scan).toMatchObject({
      name: 'QueryError',
      code: 'scan-required',
      operation: 'select.getRawMany',
      message: 'Selection requires an explicitly allowed store scan',
    });
    expect(table.message).toBe('Selection source table is not part of the client schema');
    expect(order.message).toBe('Selection order cannot be executed by the table schema');
    expect('cause' in scan).toBe(false);
    expectTypeOf(scan.code).toEqualTypeOf<QueryErrorCode>();
  });

  it('сохраняет physical cause только для read failures', () => {
    const cause = new Error('native');
    const aborted = new QueryError('transaction-aborted', 'select.getRawMany', {
      cause,
    });
    const failed = new QueryError('operation-failed', 'select.getRawMany', {
      cause,
    });

    expect(aborted.cause).toBe(cause);
    expect(failed.cause).toBe(cause);

    if (false) {
      // @ts-expect-error physical read failure требует options.
      new QueryError('operation-failed', 'select.getRawMany');
      // @ts-expect-error boundary error не принимает physical options.
      new QueryError('scan-required', 'select.getRawMany', {
        cause,
      });
      // @ts-expect-error QueryError принадлежит операциям выборки и фильтруемым mutations.
      new QueryError('scan-required', 'client.select');
    }
  });
});
