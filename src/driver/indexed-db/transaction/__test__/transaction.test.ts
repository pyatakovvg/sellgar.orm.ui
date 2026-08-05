import { IDBFactory } from 'fake-indexeddb';

import { openConnection } from '../../connection/index.ts';
import { createCompiledSchema } from '../../schema/index.ts';
import { Transaction } from '../index.ts';

interface RequestHarness<Result> {
  readonly request: IDBRequest<Result>;
  dispatch(type: 'error' | 'success'): void;
  setError(error: DOMException | null): void;
  setResult(result: Result): void;
}

interface TransactionHarness {
  readonly abort: ReturnType<typeof vi.fn>;
  readonly removeEventListener: ReturnType<typeof vi.fn>;
  readonly transaction: Transaction<'records' | 'logs'>;
  dispatch(type: 'abort' | 'complete' | 'error'): void;
  setError(error: DOMException | null): void;
}

const createRequestHarness = <Result>(): RequestHarness<Result> => {
  const target = new EventTarget();
  let error: DOMException | null = null;
  let result: Result;

  Object.defineProperties(target, {
    error: {
      get: () => error,
    },
    result: {
      get: () => result,
    },
  });

  return {
    dispatch: (type) => {
      target.dispatchEvent(new Event(type));
    },
    request: target as IDBRequest<Result>,
    setError: (value) => {
      error = value;
    },
    setResult: (value) => {
      result = value;
    },
  };
};

const createTransactionHarness = (): TransactionHarness => {
  const target = new EventTarget();
  const abort = vi.fn();
  const removeEventListener = vi.fn(target.removeEventListener.bind(target));
  let error: DOMException | null = null;

  Object.defineProperties(target, {
    abort: {
      value: abort,
    },
    error: {
      get: () => error,
    },
    mode: {
      value: 'readwrite',
    },
    objectStore: {
      value: vi.fn(() => Object.freeze({}) as IDBObjectStore),
    },
    removeEventListener: {
      value: removeEventListener,
    },
  });

  return {
    abort,
    dispatch: (type) => {
      target.dispatchEvent(new Event(type));
    },
    removeEventListener,
    setError: (value) => {
      error = value;
    },
    transaction: new Transaction(target as IDBTransaction, ['records', 'logs']),
  };
};

const createSchema = (name: string) =>
  createCompiledSchema({
    name,
    version: 1,
    stores: [
      {
        name: 'records',
        keyPath: 'id',
        autoIncrement: false,
        indexes: [],
      },
      {
        name: 'logs',
        keyPath: 'id',
        autoIncrement: false,
        indexes: [],
      },
    ],
  });

describe('Transaction terminal lifecycle', () => {
  it('выдаёт request result только после physical complete', async () => {
    const harness = createTransactionHarness();
    const request = createRequestHarness<string>();
    let settled = false;
    const operation = harness.transaction.run((transaction) =>
      transaction.store('records').request(() => request.request),
    );

    void operation.then(() => {
      settled = true;
    });

    request.setResult('stored-result');
    request.dispatch('success');
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(harness.transaction.active).toBe(true);

    harness.dispatch('complete');

    await expect(operation).resolves.toBe('stored-result');
    expect(settled).toBe(true);
    expect(harness.transaction.active).toBe(false);
    expect(harness.removeEventListener.mock.calls.map(([type]) => type)).toEqual(['complete', 'abort', 'error']);
  });

  it('при scheduling throw abort-ит transaction и ждёт terminal abort', async () => {
    const harness = createTransactionHarness();
    const cause = new Error('Request scheduling failed');
    let settled = false;
    const operation = harness.transaction.run(() => {
      throw cause;
    });

    void operation.catch(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(harness.abort).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    harness.dispatch('abort');

    await expect(operation).rejects.toBe(cause);
    expect(settled).toBe(true);
    expect(harness.transaction.active).toBe(false);
  });

  it('сохраняет request cause раньше derivative transaction error', async () => {
    const harness = createTransactionHarness();
    const request = createRequestHarness<string>();
    const cause = new DOMException('Duplicate primary key', 'ConstraintError');
    const derivative = new DOMException('Transaction aborted', 'AbortError');
    const operation = harness.transaction.run((transaction) =>
      transaction.store('records').request(() => request.request),
    );

    request.setError(cause);
    request.dispatch('error');
    harness.setError(derivative);
    harness.dispatch('error');
    harness.dispatch('abort');

    await expect(operation).rejects.toBe(cause);
  });

  it('завершает operation по transaction error, не ожидая зависший request result', async () => {
    const harness = createTransactionHarness();
    const cause = new DOMException('Physical transaction failure', 'QuotaExceededError');
    const operation = harness.transaction.run(() => new Promise<never>(() => undefined));

    harness.setError(cause);
    harness.dispatch('error');
    harness.dispatch('abort');

    await expect(operation).rejects.toBe(cause);
    await expect(harness.transaction.completion).rejects.toBe(cause);
  });

  it('завершает operation scheduling cause, если physical abort недоступен', async () => {
    const harness = createTransactionHarness();
    const cause = new Error('Scheduling failed');

    harness.abort.mockImplementation(() => {
      throw new DOMException('Transaction already inactive', 'InvalidStateError');
    });

    const operation = harness.transaction.run(() => {
      throw cause;
    });

    await expect(operation).rejects.toBe(cause);
    expect(harness.transaction.active).toBe(false);
  });

  it('проверяет fixed scope и active state до native store access', async () => {
    const harness = createTransactionHarness();

    expect(() => Reflect.apply(harness.transaction.store, harness.transaction, ['missing'])).toThrow(
      'Store "missing" is not part of the IndexedDB transaction scope',
    );

    harness.dispatch('complete');
    await Promise.resolve();

    expect(() => harness.transaction.store('records')).toThrow('IndexedDB transaction is no longer active');
  });
});

describe('Transaction integration', () => {
  it('атомарно выполняет readwrite и readonly operations нескольких stores', async () => {
    const connection = await openConnection(new IDBFactory(), createSchema('transaction-multi-store'));

    try {
      const written = await connection.transaction(['records', 'logs'], 'readwrite').run((transaction) => {
        const record = transaction.store('records').request((store) => store.add({ id: 'record-1', value: 'stored' }));
        const log = transaction.store('logs').request((store) => store.add({ id: 'log-1', value: 'created' }));

        return Promise.all([record, log]);
      });

      expect(written).toEqual(['record-1', 'log-1']);

      const stored = await connection
        .transaction(['records', 'logs'], 'readonly')
        .run((transaction) =>
          Promise.all([
            transaction.store('records').request((store) => store.get('record-1')),
            transaction.store('logs').request((store) => store.get('log-1')),
          ]),
        );

      expect(stored).toEqual([
        { id: 'record-1', value: 'stored' },
        { id: 'log-1', value: 'created' },
      ]);
    } finally {
      connection.close();
    }
  });

  it('rollback-ит все stores при synchronous scheduling failure', async () => {
    const connection = await openConnection(new IDBFactory(), createSchema('transaction-multi-store-scheduling'));
    const cause = new Error('Scheduling failed');

    try {
      const operation = connection.transaction(['records', 'logs'], 'readwrite').run((transaction) => {
        const record = transaction
          .store('records')
          .request((store) => store.put({ id: 'record-1', value: 'must rollback' }));
        const log = transaction.store('logs').request((store) => store.put({ id: 'log-1', value: 'must rollback' }));

        void record.catch(() => undefined);
        void log.catch(() => undefined);
        throw cause;
      });

      await expect(operation).rejects.toBe(cause);

      const stored = await connection
        .transaction(['records', 'logs'], 'readonly')
        .run((transaction) =>
          Promise.all([
            transaction.store('records').request((store) => store.get('record-1')),
            transaction.store('logs').request((store) => store.get('log-1')),
          ]),
        );

      expect(stored).toEqual([undefined, undefined]);
    } finally {
      connection.close();
    }
  });

  it('сохраняет failed request cause и rollback-ит соседний store', async () => {
    const connection = await openConnection(new IDBFactory(), createSchema('transaction-multi-store-request'));

    try {
      await connection
        .transaction(['records'], 'readwrite')
        .run((transaction) =>
          transaction.store('records').request((store) => store.add({ id: 'record-1', value: 'first' })),
        );

      let failedRequest: IDBRequest<IDBValidKey> | undefined;
      const operation = connection.transaction(['records', 'logs'], 'readwrite').run((transaction) => {
        const duplicate = transaction.store('records').request((store) => {
          const request = store.add({ id: 'record-1', value: 'duplicate' });

          failedRequest = request;
          return request;
        });
        const log = transaction.store('logs').request((store) => store.add({ id: 'log-1', value: 'must rollback' }));

        return Promise.all([duplicate, log]);
      });
      const cause = await operation.catch((error: unknown) => error);

      expect(failedRequest).toBeDefined();
      expect(cause).toBe(failedRequest?.error);
      expect(cause).toMatchObject({
        name: 'ConstraintError',
      });

      const log = await connection
        .transaction(['logs'], 'readonly')
        .run((transaction) => transaction.store('logs').request((store) => store.get('log-1')));

      expect(log).toBeUndefined();
    } finally {
      connection.close();
    }
  });
});
