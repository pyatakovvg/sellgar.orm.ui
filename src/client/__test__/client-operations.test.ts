import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { MutationError } from '../../error';
import { schema, table } from '../../schema';
import { Client } from '../client.ts';

class Item {
  readonly id!: string;
  category!: string;
  position!: number;
  value!: string;

  label(): string {
    return `${this.category}:${this.value}`;
  }
}

interface LogRecord {
  readonly id: string;
  readonly value: string;
}

const items = table('items')
  .entity(Item)
  .define({
    primaryKey: 'id',
    indexes: [
      {
        keyPath: 'category',
      },
      {
        keyPath: ['category', 'position'],
      },
    ],
  });

const logs = table('logs').record<LogRecord>().define({
  primaryKey: 'id',
  indexes: [],
});

const databaseSchema = schema({
  name: 'client-operations-test',
  version: 1,
  tables: [items, logs],
});

const item = (id: string, position: number, value = id): Item =>
  Object.assign(new Item(), {
    id,
    category: 'chat',
    position,
    value,
  });

let client: Client<typeof databaseSchema>;

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);

  client = new Client<typeof databaseSchema>();
  await client.open(databaseSchema);
});

afterEach(() => {
  client.close();
  vi.unstubAllGlobals();
});

describe('Client operations', () => {
  it('различает insert и upsert и возвращает raw record либо entity', async () => {
    const first = item('item-1', 1, 'first');

    await expect(client.insert(items).values(first).execute()).resolves.toBe('item-1');
    await expect(client.insert(items).values(first).execute()).rejects.toBeInstanceOf(MutationError);

    await client.upsert(items).values(item('item-1', 1, 'changed')).execute();

    const raw = await client.select(items).where(items.field('id'), 'item-1').getRawOne();
    const entity = await client.select(items).where(items.field('id'), 'item-1').getOne();

    expect(raw).toEqual({
      id: 'item-1',
      category: 'chat',
      position: 1,
      value: 'changed',
    });
    expect(raw).not.toBeInstanceOf(Item);
    expect(entity).toBeInstanceOf(Item);
    expect(entity?.label()).toBe('chat:changed');
  });

  it('вставляет массив записей и выполняет индексированную сортировку', async () => {
    await client
      .insert(items)
      .values([item('item-3', 3), item('item-1', 1), item('item-2', 2)])
      .execute();

    const result = await client
      .select(items)
      .where(items.field('category'), 'chat')
      .orderBy(items.field('position'), 'asc')
      .getMany();

    expect(result.map(({ id }) => id)).toEqual(['item-1', 'item-2', 'item-3']);
    expect(result.every((record) => record instanceof Item)).toBe(true);
  });

  it('ограничивает ordered result после фильтрации', async () => {
    await client
      .insert(items)
      .values([item('item-4', 4), item('item-2', 2), item('item-1', 1), item('item-3', 3)])
      .execute();

    const result = await client
      .select(items)
      .where(items.field('category'), 'chat')
      .orderBy(items.field('position'), 'desc')
      .limit(2)
      .getMany();

    expect(result.map(({ id }) => id)).toEqual(['item-4', 'item-3']);
    await expect(client.select(items).where(items.field('category'), 'chat').limit(0).getMany()).resolves.toEqual([]);
    expect(() => client.select(items).limit(-1)).toThrow(new TypeError('Selection limit is invalid'));
  });

  it('возвращает хвост ordered result в заданном порядке', async () => {
    await client
      .insert(items)
      .values([item('item-4', 4), item('item-2', 2), item('item-1', 1), item('item-3', 3)])
      .execute();

    const result = await client
      .select(items)
      .where(items.field('category'), 'chat')
      .orderBy(items.field('position'), 'asc')
      .takeLast(2)
      .getMany();

    expect(result.map(({ id }) => id)).toEqual(['item-3', 'item-4']);
    await expect(
      client
        .select(items)
        .where(items.field('category'), 'chat')
        .orderBy(items.field('position'), 'asc')
        .takeLast(0)
        .getMany(),
    ).resolves.toEqual([]);
    expect(() => client.select(items).takeLast(-1)).toThrow(new TypeError('Selection takeLast is invalid'));
  });

  it('обновляет и удаляет только записи, выбранные where', async () => {
    await client.insert(items).values([item('item-1', 1), item('item-2', 2)]).execute();

    await expect(
      client.update(items).set({ value: 'updated' }).where(items.field('id'), 'item-1').execute(),
    ).resolves.toBe(1);
    await expect(client.delete(items).where(items.field('id'), 'item-2').execute()).resolves.toBe(1);

    await expect(client.select(items).where(items.field('id'), 'item-1').getOne()).resolves.toMatchObject({
      id: 'item-1',
      value: 'updated',
    });
    await expect(client.select(items).where(items.field('id'), 'item-2').getOne()).resolves.toBeUndefined();
  });

  it('выполняет несколько таблиц атомарно и возвращает результат callback', async () => {
    const result = await client.transaction([items, logs], async (transaction) => {
      await transaction.insert(items).values(item('item-1', 1)).execute();
      await transaction.insert(logs).values({ id: 'log-1', value: 'created' }).execute();

      return transaction.select(items).where(items.field('id'), 'item-1').getOne();
    });

    expect(result).toBeInstanceOf(Item);
    await expect(client.select(logs).where(logs.field('id'), 'log-1').getRawOne()).resolves.toEqual({
      id: 'log-1',
      value: 'created',
    });
  });

  it('выполняет последовательные ordered reads внутри одной транзакции', async () => {
    await client.insert(items).values([item('item-1', 1), item('item-2', 2), item('item-3', 3)]).execute();

    const result = await client.transaction([items], async (transaction) => {
      const first = await transaction
        .select(items)
        .where(items.field('category'), 'chat')
        .orderBy(items.field('position'), 'desc')
        .limit(1)
        .getOne();
      const second = await transaction
        .select(items)
        .where(items.field('category'), 'chat')
        .orderBy(items.field('position'), 'asc')
        .getOne();

      return [first, second] as const;
    });

    expect(result.map((record) => record?.id)).toEqual(['item-3', 'item-1']);
  });

  it('откатывает все таблицы при ошибке callback', async () => {
    const failure = new Error('application failure');

    await expect(
      client.transaction([items, logs], async (transaction) => {
        await transaction.insert(items).values(item('item-1', 1)).execute();
        await transaction.insert(logs).values({ id: 'log-1', value: 'must rollback' }).execute();
        throw failure;
      }),
    ).rejects.toBe(failure);

    await expect(client.select(items).where(items.field('id'), 'item-1').getRawOne()).resolves.toBeUndefined();
    await expect(client.select(logs).where(logs.field('id'), 'log-1').getRawOne()).resolves.toBeUndefined();
  });
});
