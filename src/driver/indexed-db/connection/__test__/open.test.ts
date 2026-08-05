import { IDBFactory } from 'fake-indexeddb';

import { createCompiledSchema } from '../../schema';
import type { CompiledSchema } from '../../schema';
import { NativeConnection } from '../native-connection.ts';
import { openConnection } from '../open.ts';

const createSchema = (name: string): CompiledSchema =>
  createCompiledSchema({
    name,
    version: 1,
    stores: [
      {
        name: 'messages',
        keyPath: 'id',
        autoIncrement: false,
        indexes: [
          {
            name: '["chatId",false,false]',
            keyPath: 'chatId',
            unique: false,
            multiEntry: false,
          },
        ],
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

interface OpenRequestHarness {
  readonly factory: IDBFactory;
  readonly request: IDBOpenDBRequest;
  setResult(value: IDBDatabase): void;
  setTransaction(value: IDBTransaction | null): void;
}

const createOpenRequestHarness = (): OpenRequestHarness => {
  const request = new EventTarget();
  let result: IDBDatabase;
  let transaction: IDBTransaction | null = null;

  Object.defineProperties(request, {
    result: {
      get: () => result,
    },
    error: {
      get: () => null,
    },
    transaction: {
      get: () => transaction,
    },
  });

  return {
    factory: {
      open: () => request as IDBOpenDBRequest,
    } as unknown as IDBFactory,
    request: request as IDBOpenDBRequest,
    setResult: (value) => {
      result = value;
    },
    setTransaction: (value) => {
      transaction = value;
    },
  };
};

const createVersionChangeEvent = (oldVersion: number, newVersion: number | null): Event => {
  const event = new Event('upgradeneeded');

  Object.defineProperties(event, {
    oldVersion: {
      value: oldVersion,
    },
    newVersion: {
      value: newVersion,
    },
  });

  return event;
};

const createNativeConnectionStub = (): IDBDatabase => {
  const database = new EventTarget();

  Object.defineProperty(database, 'close', {
    value: vi.fn(),
  });

  return database as IDBDatabase;
};

describe('openConnection', () => {
  it('открывает новую database и устанавливает compiled schema', async () => {
    const factory = new IDBFactory();
    const connection = await openConnection(factory, createSchema('open-new'));

    expect(connection).toBeInstanceOf(NativeConnection);
    expect(connection.closed).toBe(false);

    connection.close();

    const database = await openNative(factory, 'open-new', 1);

    try {
      expect(database.name).toBe('open-new');
      expect(database.version).toBe(1);
      expect(Array.from(database.objectStoreNames)).toEqual(['messages']);

      const store = database.transaction('messages', 'readonly').objectStore('messages');
      expect(store.keyPath).toBe('id');
      expect(Array.from(store.indexNames)).toEqual(['["chatId",false,false]']);
    } finally {
      database.close();
    }
  });

  it('повторно открывает существующую version 1 без установки schema', async () => {
    const factory = new IDBFactory();
    const schema = createSchema('open-existing');
    const first = await openConnection(factory, schema);

    first.close();

    const second = await openConnection(factory, schema);

    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(second).not.toBe(first);

    second.close();
  });

  it('отклоняет internal operation physical request error', async () => {
    const factory = new IDBFactory();
    const newer = await openNative(factory, 'open-version-error', 2);

    newer.close();

    await expect(openConnection(factory, createSchema('open-version-error'))).rejects.toMatchObject({
      name: 'VersionError',
    });
  });

  it('оставляет Promise pending при blocked и завершает его последующим success', async () => {
    const harness = createOpenRequestHarness();
    const database = createNativeConnectionStub();
    let state: 'pending' | 'resolved' | 'rejected' = 'pending';
    const opening = openConnection(harness.factory, createSchema('open-blocked'));

    void opening.then(
      () => {
        state = 'resolved';
      },
      () => {
        state = 'rejected';
      },
    );

    harness.request.dispatchEvent(new Event('blocked'));
    await Promise.resolve();

    expect(state).toBe('pending');

    harness.setResult(database);
    harness.request.dispatchEvent(new Event('success'));

    const connection = await opening;

    expect(connection).toBeInstanceOf(NativeConnection);
    expect(connection.closed).toBe(false);
    expect(state).toBe('resolved');

    connection.close();
  });

  it('abort-ит upgrade transaction при неподдерживаемом version transition', async () => {
    const harness = createOpenRequestHarness();
    const abort = vi.fn();

    harness.setTransaction({
      abort,
    } as unknown as IDBTransaction);

    const opening = openConnection(harness.factory, createSchema('open-transition'));

    harness.request.dispatchEvent(createVersionChangeEvent(1, 2));

    await expect(opening).rejects.toThrow('schema transition from version 1 to 2 is not supported');
    expect(abort).toHaveBeenCalledOnce();
  });

  it('abort-ит upgrade transaction и сохраняет installer error', async () => {
    const harness = createOpenRequestHarness();
    const abort = vi.fn();
    const installerError = new Error('Schema installation failed');

    harness.setResult({
      createObjectStore: () => {
        throw installerError;
      },
    } as unknown as IDBDatabase);
    harness.setTransaction({
      abort,
    } as unknown as IDBTransaction);

    const opening = openConnection(harness.factory, createSchema('open-install-error'));

    harness.request.dispatchEvent(createVersionChangeEvent(0, 1));

    await expect(opening).rejects.toBe(installerError);
    expect(abort).toHaveBeenCalledOnce();
  });
});
