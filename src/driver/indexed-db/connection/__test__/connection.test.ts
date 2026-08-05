import { IDBFactory } from 'fake-indexeddb';

import { createCompiledSchema } from '../../schema/index.ts';
import { NativeConnection, openConnection } from '../index.ts';

interface NativeHarness {
  readonly close: ReturnType<typeof vi.fn>;
  readonly database: IDBDatabase;
  readonly removeEventListener: ReturnType<typeof vi.fn>;
}

const createNativeTransaction = (mode: 'readonly' | 'readwrite'): IDBTransaction => {
  const transaction = new EventTarget();

  Object.defineProperties(transaction, {
    abort: {
      value: vi.fn(),
    },
    error: {
      value: null,
    },
    mode: {
      value: mode,
    },
    objectStore: {
      value: vi.fn(() => Object.freeze({}) as IDBObjectStore),
    },
  });

  return transaction as IDBTransaction;
};

const createNativeHarness = (): NativeHarness => {
  const database = new EventTarget();
  const close = vi.fn();
  const removeEventListener = vi.fn(database.removeEventListener.bind(database));

  Object.defineProperties(database, {
    close: {
      value: close,
    },
    removeEventListener: {
      value: removeEventListener,
    },
    transaction: {
      value: vi.fn((_names: string[], mode: 'readonly' | 'readwrite') => createNativeTransaction(mode)),
    },
  });

  return {
    close,
    database: database as IDBDatabase,
    removeEventListener,
  };
};

const createRecordsSchema = (name: string) =>
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
    ],
  });

const openNative = (factory: IDBFactory, name: string, version: number): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(name, version);

    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error);
    });
  });

describe('NativeConnection lifecycle', () => {
  it('закрывает physical connection один раз', () => {
    const harness = createNativeHarness();
    const connection = new NativeConnection(harness.database);

    expect(connection.closed).toBe(false);

    connection.close();
    connection.close();

    expect(connection.closed).toBe(true);
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.removeEventListener.mock.calls.map(([type]) => type)).toEqual(['versionchange', 'close']);
  });

  it('автоматически закрывается при versionchange', () => {
    const harness = createNativeHarness();
    const connection = new NativeConnection(harness.database);

    harness.database.dispatchEvent(new Event('versionchange'));

    expect(connection.closed).toBe(true);
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.removeEventListener.mock.calls.map(([type]) => type)).toEqual(['versionchange', 'close']);
  });

  it('отражает abnormal native close без повторного physical close', () => {
    const harness = createNativeHarness();
    const connection = new NativeConnection(harness.database);

    harness.database.dispatchEvent(new Event('close'));

    expect(connection.closed).toBe(true);
    expect(harness.close).not.toHaveBeenCalled();
    expect(harness.removeEventListener.mock.calls.map(([type]) => type)).toEqual(['versionchange', 'close']);
  });

  it('удаляет lifecycle listeners после закрытия', () => {
    const explicitHarness = createNativeHarness();
    const explicit = new NativeConnection(explicitHarness.database);

    explicit.close();
    explicitHarness.database.dispatchEvent(new Event('versionchange'));

    expect(explicitHarness.close).toHaveBeenCalledOnce();

    const nativeHarness = createNativeHarness();
    const native = new NativeConnection(nativeHarness.database);

    nativeHarness.database.dispatchEvent(new Event('close'));
    native.close();
    nativeHarness.database.dispatchEvent(new Event('versionchange'));

    expect(nativeHarness.close).not.toHaveBeenCalled();
  });
});

describe('NativeConnection transaction start', () => {
  it('создаёт transaction по snapshot multi-store scope и mode', () => {
    const harness = createNativeHarness();
    const connection = new NativeConnection(harness.database);
    const scope: ['records', 'logs'] = ['records', 'logs'];
    const transaction = connection.transaction(scope, 'readwrite');

    scope.push('logs');

    expect(harness.database.transaction).toHaveBeenCalledWith(['records', 'logs'], 'readwrite');
    expect(transaction.mode).toBe('readwrite');
    expect(transaction.store('records')).toBeDefined();
    expect(transaction.store('logs')).toBeDefined();

    if (false) {
      // @ts-expect-error store отсутствует в inferred fixed scope.
      transaction.store('missing');
    }
  });

  it('отклоняет empty internal scope до browser API', () => {
    const harness = createNativeHarness();
    const connection = new NativeConnection(harness.database);

    expect(() => Reflect.apply(connection.transaction, connection, [[], 'readonly'])).toThrow(
      'IndexedDB transaction scope must not be empty',
    );
    expect(harness.database.transaction).not.toHaveBeenCalled();
  });

  it('сохраняет synchronous transaction start failure по identity', () => {
    const harness = createNativeHarness();
    const cause = new DOMException('Connection cannot create a transaction', 'InvalidStateError');

    vi.mocked(harness.database.transaction).mockImplementation(() => {
      throw cause;
    });

    const connection = new NativeConnection(harness.database);

    expect(() => connection.transaction(['records'], 'readonly')).toThrow(cause);
  });
});

describe('NativeConnection integration', () => {
  it('освобождает native version upgrade другого connection', async () => {
    const factory = new IDBFactory();
    const name = 'connection-versionchange';
    const connection = await openConnection(factory, createRecordsSchema(name));

    const upgraded = await openNative(factory, name, 2);

    try {
      expect(connection.closed).toBe(true);
      expect(upgraded.version).toBe(2);
    } finally {
      upgraded.close();
    }
  });
});
