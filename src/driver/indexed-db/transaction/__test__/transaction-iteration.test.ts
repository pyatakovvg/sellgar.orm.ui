import { Transaction } from '../index.ts';

interface CursorHarness {
  readonly continue: ReturnType<typeof vi.fn>;
  readonly cursor: IDBCursorWithValue;
}

interface RequestHarness<Result> {
  readonly removeEventListener: ReturnType<typeof vi.fn>;
  readonly request: IDBRequest<Result>;
  dispatch(type: 'error' | 'success'): void;
  setError(error: DOMException | null): void;
  setResult(result: Result): void;
}

interface TransactionHarness {
  readonly abort: ReturnType<typeof vi.fn>;
  readonly transaction: Transaction<'records'>;
}

const createCursorHarness = <RecordType>(
  record: RecordType,
  continueError?: unknown,
  key: IDBValidKey = 'index-key',
  primaryKey: IDBValidKey = 'primary-key',
): CursorHarness => {
  const continueCursor = vi.fn(() => {
    if (continueError !== undefined) {
      throw continueError;
    }
  });

  return {
    continue: continueCursor,
    cursor: {
      continue: continueCursor,
      key,
      primaryKey,
      value: record,
    } as unknown as IDBCursorWithValue,
  };
};

const createRequestHarness = <Result>(): RequestHarness<Result> => {
  const target = new EventTarget();
  const removeEventListener = vi.fn(target.removeEventListener.bind(target));
  let error: DOMException | null = null;
  let result: Result;

  Object.defineProperties(target, {
    error: {
      get: () => error,
    },
    removeEventListener: {
      value: removeEventListener,
    },
    result: {
      get: () => result,
    },
  });

  return {
    dispatch: (type) => {
      target.dispatchEvent(new Event(type));
    },
    removeEventListener,
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

  Object.defineProperties(target, {
    abort: {
      value: abort,
    },
    error: {
      value: null,
    },
    mode: {
      value: 'readonly',
    },
    objectStore: {
      value: vi.fn(() => Object.freeze({}) as IDBObjectStore),
    },
  });

  return {
    abort,
    transaction: new Transaction(target as IDBTransaction, ['records']),
  };
};

describe('Transaction Store cursor iteration', () => {
  it('посещает каждый cursor result и завершается только на terminal null', async () => {
    const harness = createTransactionHarness();
    const request = createRequestHarness<IDBCursorWithValue | null>();
    const first = createCursorHarness(
      {
        id: 'first',
      },
      undefined,
      'first-index',
      'first-primary',
    );
    const second = createCursorHarness(
      {
        id: 'second',
      },
      undefined,
      'second-index',
      'second-primary',
    );
    const entries: unknown[] = [];
    let settled = false;
    const operation = harness.transaction.store('records').iterate(
      () => request.request,
      (entry) => {
        entries.push(entry);

        return 'continue';
      },
    );

    void operation.then(() => {
      settled = true;
    });

    request.setResult(first.cursor);
    request.dispatch('success');
    request.setResult(second.cursor);
    request.dispatch('success');
    await Promise.resolve();

    expect(entries).toEqual([
      {
        key: 'first-index',
        primaryKey: 'first-primary',
        record: {
          id: 'first',
        },
      },
      {
        key: 'second-index',
        primaryKey: 'second-primary',
        record: {
          id: 'second',
        },
      },
    ]);
    expect(entries.every(Object.isFrozen)).toBe(true);
    expect(entries.every((entry) => !('continue' in Object(entry)))).toBe(true);
    expect(first.continue).toHaveBeenCalledOnce();
    expect(second.continue).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    request.setResult(null);
    request.dispatch('success');

    await expect(operation).resolves.toBeUndefined();
    expect(settled).toBe(true);
    expect(request.removeEventListener.mock.calls.map(([type]) => type)).toEqual(['success', 'error']);
  });

  it('останавливает cursor без continue и abort transaction', async () => {
    const harness = createTransactionHarness();
    const request = createRequestHarness<IDBCursorWithValue | null>();
    const cursor = createCursorHarness({
      id: 'record',
    });
    const visit = vi.fn(() => 'stop' as const);
    const operation = harness.transaction.store('records').iterate(() => request.request, visit);

    request.setResult(cursor.cursor);
    request.dispatch('success');

    await expect(operation).resolves.toBeUndefined();
    expect(visit).toHaveBeenCalledOnce();
    expect(cursor.continue).not.toHaveBeenCalled();
    expect(harness.abort).not.toHaveBeenCalled();
    expect(request.removeEventListener.mock.calls.map(([type]) => type)).toEqual(['success', 'error']);
  });

  it('abort-ит transaction при cursor open throw', () => {
    const harness = createTransactionHarness();
    const cause = new DOMException('Cursor open failed', 'InvalidStateError');

    expect(() =>
      harness.transaction.store('records').iterate(() => {
        throw cause;
      }, vi.fn()),
    ).toThrow(cause);
    expect(harness.abort).toHaveBeenCalledOnce();
  });

  it('abort-ит transaction и сохраняет visit cause', async () => {
    const harness = createTransactionHarness();
    const request = createRequestHarness<IDBCursorWithValue | null>();
    const cursor = createCursorHarness({
      id: 'record',
    });
    const cause = new Error('Record visitor failed');
    const operation = harness.transaction.store('records').iterate(
      () => request.request,
      () => {
        throw cause;
      },
    );

    request.setResult(cursor.cursor);
    request.dispatch('success');

    await expect(operation).rejects.toBe(cause);
    expect(harness.abort).toHaveBeenCalledOnce();
    expect(cursor.continue).not.toHaveBeenCalled();
  });

  it('abort-ит transaction и сохраняет cursor continue cause', async () => {
    const harness = createTransactionHarness();
    const request = createRequestHarness<IDBCursorWithValue | null>();
    const cause = new DOMException('Cursor continuation failed', 'InvalidStateError');
    const cursor = createCursorHarness(
      {
        id: 'record',
      },
      cause,
    );
    const operation = harness.transaction.store('records').iterate(
      () => request.request,
      vi.fn(() => 'continue' as const),
    );

    request.setResult(cursor.cursor);
    request.dispatch('success');

    await expect(operation).rejects.toBe(cause);
    expect(harness.abort).toHaveBeenCalledOnce();
  });

  it('сохраняет cursor request error и удаляет listeners', async () => {
    const harness = createTransactionHarness();
    const request = createRequestHarness<IDBCursorWithValue | null>();
    const cause = new DOMException('Cursor request failed', 'UnknownError');
    const operation = harness.transaction.store('records').iterate(
      () => request.request,
      vi.fn(() => 'continue' as const),
    );

    request.setError(cause);
    request.dispatch('error');

    await expect(operation).rejects.toBe(cause);
    expect(request.removeEventListener.mock.calls.map(([type]) => type)).toEqual(['success', 'error']);
  });
});
