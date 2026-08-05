import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { ClientError } from '../../error/index.ts';
import type { Select } from '../../select/index.ts';
import { schema, Schema, table } from '../../schema/index.ts';
import { Client, ClientInterface } from '../index.ts';

interface RecordValue {
  readonly id: string;
  readonly value: string;
}

const records = table('records').record<RecordValue>().define({
  primaryKey: 'id',
  indexes: [],
});

const recordsSchema = schema({
  name: 'client-test',
  version: 1,
  tables: [records],
});

const otherSchema = schema({
  name: 'other-client-test',
  version: 1,
  tables: [records],
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

beforeEach(() => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Client lifecycle', () => {
  it('связывает тот же client instance с exact Schema', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());

    const client: ClientInterface<typeof recordsSchema> = new Client();

    await client.open(recordsSchema);

    expectTypeOf(client.select(records)).toEqualTypeOf<Select<typeof records>>();

    client.close();
  });

  it('разделяет один in-flight Promise между concurrent open той же Schema', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());

    const client = new Client<typeof recordsSchema>();
    const first = client.open(recordsSchema);
    const second = client.open(recordsSchema);

    expect(first).toBe(second);

    await first;
    client.close();
  });

  it('делает repeated successful open идемпотентным', async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, 'open');

    vi.stubGlobal('indexedDB', factory);

    const client = new Client<typeof recordsSchema>();

    await client.open(recordsSchema);
    await client.open(recordsSchema);

    expect(open).toHaveBeenCalledOnce();

    client.close();
  });

  it('сохраняет Schema binding после failed open и разрешает retry той же Schema', async () => {
    const client = new Client<typeof recordsSchema>();

    vi.stubGlobal('indexedDB', undefined);

    await expect(client.open(recordsSchema)).rejects.toMatchObject({
      name: 'ClientError',
      code: 'unavailable',
      operation: 'client.open',
    });

    vi.stubGlobal('indexedDB', new IDBFactory());

    await expect(client.open(recordsSchema)).resolves.toBeUndefined();
    expect(client.select(records)).toBeDefined();

    client.close();
  });

  it('отклоняет другой exact Schema descriptor после binding', async () => {
    vi.stubGlobal('indexedDB', undefined);

    const client = new Client<Schema>();

    await expect(client.open(recordsSchema)).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(client.open(otherSchema)).rejects.toMatchObject({
      name: 'ClientError',
      code: 'schema-mismatch',
      operation: 'client.open',
      message: 'Client is already bound to another schema',
    });

    client.close();
  });

  it('делает close terminal и идемпотентным из new state', async () => {
    const client = new Client<typeof recordsSchema>();

    client.close();
    client.close();

    await expect(client.open(recordsSchema)).rejects.toMatchObject({
      name: 'ClientError',
      code: 'closed',
      operation: 'client.open',
    });
  });

  it('закрывает поздний physical handle при close во время opening', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());

    const client = new Client<typeof recordsSchema>();
    const opening = client.open(recordsSchema);

    client.close();

    await expect(opening).rejects.toMatchObject({
      name: 'ClientError',
      code: 'closed',
      operation: 'client.open',
    });
    await expect(client.open(recordsSchema)).rejects.toMatchObject({
      code: 'closed',
      operation: 'client.open',
    });
  });

  it('синхронизирует terminal state после native versionchange', async () => {
    const factory = new IDBFactory();

    vi.stubGlobal('indexedDB', factory);

    const client = new Client<typeof recordsSchema>();

    await client.open(recordsSchema);

    const newer = await openNative(factory, recordsSchema.name, 2);

    expect(() => client.select(records)).toThrow(
      expect.objectContaining({
        name: 'ClientError',
        code: 'closed',
        operation: 'client.select',
      }),
    );
    await expect(client.open(recordsSchema)).rejects.toMatchObject({
      code: 'closed',
      operation: 'client.open',
    });

    newer.close();
  });
});

describe('Client open errors', () => {
  it('возвращает стабильную unavailable error без native factory', async () => {
    vi.stubGlobal('indexedDB', undefined);

    const error = await new Client<typeof recordsSchema>().open(recordsSchema).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ClientError);
    expect(error).toMatchObject({
      name: 'ClientError',
      code: 'unavailable',
      operation: 'client.open',
      message: 'Browser database storage is not available',
    });
  });

  it('преобразует native VersionError и сохраняет cause', async () => {
    const factory = new IDBFactory();
    const newer = await openNative(factory, recordsSchema.name, 2);

    newer.close();
    vi.stubGlobal('indexedDB', factory);

    const error = await new Client<typeof recordsSchema>().open(recordsSchema).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ClientError);
    expect(error).toMatchObject({
      code: 'version-mismatch',
      operation: 'client.open',
      message: 'Stored database version is not supported',
    });
    expect((error as ClientError).cause).toMatchObject({
      name: 'VersionError',
    });
  });

  it('не раскрывает unknown physical open error через public message', async () => {
    const cause = new DOMException('Physical permission details', 'SecurityError');

    vi.stubGlobal('indexedDB', {
      open: () => {
        throw cause;
      },
    } as unknown as IDBFactory);

    const error = await new Client<typeof recordsSchema>().open(recordsSchema).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ClientError);
    expect(error).toMatchObject({
      code: 'open-failed',
      operation: 'client.open',
      message: 'Database could not be opened',
    });
    expect((error as ClientError).cause).toBe(cause);
    expect((error as ClientError).message).not.toContain(cause.message);
  });
});
