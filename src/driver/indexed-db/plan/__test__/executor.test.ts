import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { QueryError } from '../../../../error/index.ts';
import { and, between, eq, Expression, gt, isMissing, lte, matches, oneOf, or } from '../../../../expression/index.ts';
import { plan } from '../../../../planner/index.ts';
import type { Plan } from '../../../../planner/index.ts';
import { selection } from '../../../../selection/index.ts';
import { Range, withinPrefix } from '../../../../range/index.ts';
import { schema, table } from '../../../../schema/index.ts';
import { NativeConnection, openConnection } from '../../connection/index.ts';
import { createCompiledSchema, compileSchema } from '../../schema/index.ts';
import { Writer } from '../../mutation/index.ts';
import { Executor } from '../index.ts';

interface MessageRecord {
  readonly id: string;
  readonly position: number;
  readonly status: 'delivered' | 'pending';
  readonly text: string;
  readonly optionalCode?: string;
}

interface CompoundMessageRecord {
  readonly tenantId: string;
  readonly id: string;
  readonly chatId: string;
  readonly position: number;
  readonly status: 'delivered' | 'pending';
}

const messages = table('messages')
  .record<MessageRecord>()
  .define({
    primaryKey: 'id',
    indexes: [
      {
        keyPath: 'position',
      },
    ],
  });

const compoundMessages = table('compound-messages')
  .record<CompoundMessageRecord>()
  .define({
    primaryKey: ['tenantId', 'id'],
    indexes: [
      {
        keyPath: ['chatId', 'position'],
      },
      {
        keyPath: 'status',
      },
    ],
  });

const records: readonly MessageRecord[] = [
  {
    id: 'message-1',
    position: 10,
    status: 'pending',
    text: 'first',
  },
  {
    id: 'message-2',
    position: 20,
    status: 'delivered',
    text: 'second',
    optionalCode: 'known',
  },
  {
    id: 'message-3',
    position: 30,
    status: 'pending',
    text: 'third',
  },
];

const compoundRecords: readonly CompoundMessageRecord[] = [
  {
    tenantId: 'tenant-1',
    id: 'message-1',
    chatId: 'chat-1',
    position: 10,
    status: 'pending',
  },
  {
    tenantId: 'tenant-1',
    id: 'message-2',
    chatId: 'chat-1',
    position: 20,
    status: 'delivered',
  },
  {
    tenantId: 'tenant-2',
    id: 'message-3',
    chatId: 'chat-2',
    position: 30,
    status: 'pending',
  },
];

interface Harness {
  readonly connection: NativeConnection;
  readonly executor: Executor;
}

let databaseSequence = 0;

const createHarness = async (): Promise<Harness> => {
  databaseSequence += 1;

  const value = schema({
    name: `plan-executor-${databaseSequence}`,
    version: 1,
    tables: [messages],
  });
  const connection = await openConnection(new IDBFactory(), compileSchema(value));

  await Writer.standalone(connection).insertMany<string>(
    messages.name,
    records.map((record) => [record]),
  );

  return {
    connection,
    executor: new Executor(connection, IDBKeyRange),
  };
};

const createCompoundHarness = async (): Promise<Harness> => {
  databaseSequence += 1;

  const value = schema({
    name: `compound-plan-executor-${databaseSequence}`,
    version: 1,
    tables: [compoundMessages],
  });
  const connection = await openConnection(new IDBFactory(), compileSchema(value));

  await Writer.standalone(connection).insertMany<readonly [string, string]>(
    compoundMessages.name,
    compoundRecords.map((record) => [record]),
  );

  return {
    connection,
    executor: new Executor(connection, IDBKeyRange),
  };
};

const idsOf = <RecordType extends Readonly<{ id: string }>>(result: readonly RecordType[]): string[] =>
  result.map((record) => record.id).sort();

type MessagePlan = Plan<typeof messages>;
type MessageSource = Extract<MessagePlan, { type: 'primary' | 'index' | 'union' }>;
type MessageUnion = Extract<MessagePlan, { type: 'union' }>;
type MessageIntersection = Extract<MessagePlan, { type: 'intersection' }>;
type MessagePostFilter = Extract<MessagePlan, { type: 'post-filter' }>;

const source = (value: MessagePlan): MessageSource => {
  if (
    value.type === 'empty' ||
    value.type === 'intersection' ||
    value.type === 'post-filter' ||
    value.type === 'scan' ||
    value.type === 'ordered'
  ) {
    throw new Error('Expected indexed source Plan');
  }

  return value;
};

const union = (...plans: [MessageSource, MessageSource, ...MessageSource[]]): MessageUnion =>
  Object.freeze({
    type: 'union',
    table: messages,
    plans: Object.freeze(plans),
  });

const intersection = (...plans: [MessageSource, MessageSource, ...MessageSource[]]): MessageIntersection =>
  Object.freeze({
    type: 'intersection',
    table: messages,
    plans: Object.freeze(plans),
  });

describe('IndexedDB readonly Plan Executor', () => {
  it('выполняет Empty Plan без native dependencies и возвращает новый array', async () => {
    const transaction = vi.fn();
    const only = vi.fn();
    const connection = {
      transaction,
    } as unknown as NativeConnection;
    const keyRange = {
      only,
    } as unknown as typeof IDBKeyRange;
    const value: Plan<typeof messages> = Object.freeze({
      type: 'empty',
      table: messages,
    });
    const executor = new Executor(connection, keyRange);
    const first = await executor.execute(value);
    const second = await executor.execute(value);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(first).not.toBe(second);
    expect(transaction).not.toHaveBeenCalled();
    expect(only).not.toHaveBeenCalled();

    if (false) {
      const primary = source(plan(selection(messages).where(eq(messages.field('id'), 'message-1')), 'forbid'));
      const nested = intersection(primary, primary);
      const postFilter = plan(
        selection(messages).where(and(eq(messages.field('id'), 'message-1'), eq(messages.field('text'), 'first'))),
        'forbid',
      );
      const scan = plan(selection(messages), 'allow');

      // @ts-expect-error Intersection требует минимум две branches.
      intersection(primary);
      // @ts-expect-error Nested Intersection не входит в BranchPlan.
      intersection(nested, primary);
      // @ts-expect-error Post-filter не входит в BranchPlan.
      intersection(postFilter, primary);
      // @ts-expect-error Scan не входит в BranchPlan.
      intersection(scan, primary);
    }
  });

  it('выполняет primary only plan', async () => {
    const harness = await createHarness();

    try {
      const result = await harness.executor.execute(
        plan(selection(messages).where(eq(messages.field('id'), 'message-2')), 'forbid'),
      );

      expect(result).toEqual([records[1]]);
      expect(result[0]).not.toBe(records[1]);
      expect(result[0]).not.toHaveProperty('record');
      expect(result[0]).not.toHaveProperty('primaryKey');
    } finally {
      harness.connection.close();
    }
  });

  it('выполняет lower, upper и between index ranges', async () => {
    const harness = await createHarness();

    try {
      const cases = [
        {
          query: selection(messages).where(gt(messages.field('position'), 10)),
          expected: ['message-2', 'message-3'],
        },
        {
          query: selection(messages).where(between(messages.field('position'), 10, 20)),
          expected: ['message-1', 'message-2'],
        },
        {
          query: selection(messages).where(lte(messages.field('position'), 20)),
          expected: ['message-1', 'message-2'],
        },
      ] as const;

      for (const entry of cases) {
        const result = await harness.executor.execute(plan(entry.query, 'forbid'));

        expect(idsOf(result)).toEqual(entry.expected);
      }
    } finally {
      harness.connection.close();
    }
  });

  it('выполняет primary, index и mixed unions с deduplication', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const cases = [
      {
        value: union(
          source(plan(selection(messages).where(eq(messages.field('id'), 'message-1')), 'forbid')),
          source(plan(selection(messages).where(eq(messages.field('id'), 'message-2')), 'forbid')),
        ),
        expected: ['message-1', 'message-2'],
      },
      {
        value: union(
          source(plan(selection(messages).where(gt(messages.field('position'), 10)), 'forbid')),
          source(plan(selection(messages).where(lte(messages.field('position'), 20)), 'forbid')),
        ),
        expected: ['message-1', 'message-2', 'message-3'],
      },
      {
        value: union(
          source(plan(selection(messages).where(eq(messages.field('id'), 'message-2')), 'forbid')),
          source(plan(selection(messages).where(eq(messages.field('position'), 20)), 'forbid')),
        ),
        expected: ['message-2'],
      },
    ] as const;

    try {
      for (const entry of cases) {
        const result = await harness.executor.execute(entry.value);

        expect(idsOf(result)).toEqual(entry.expected);
        expect(result.every((record) => !('primaryKey' in record) && !('record' in record))).toBe(true);
      }

      expect(transaction).toHaveBeenCalledTimes(cases.length);
      expect(transaction.mock.calls.every(([scope, mode]) => scope[0] === 'messages' && mode === 'readonly')).toBe(
        true,
      );
    } finally {
      harness.connection.close();
    }
  });

  it('выполняет oneOf через сгенерированный Union Plan в одной transaction', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const value = plan(selection(messages).where(oneOf(messages.field('position'), [30, 10, 20])), 'forbid');

    try {
      expect(value.type).toBe('union');
      await expect(harness.executor.execute(value).then(idsOf)).resolves.toEqual([
        'message-1',
        'message-2',
        'message-3',
      ]);
      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith(['messages'], 'readonly');
    } finally {
      harness.connection.close();
    }
  });

  it('выполняет overlapping nested logical or эквивалентно Expression в одной transaction', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const expression = or(
      gt(messages.field('position'), 10),
      or(lte(messages.field('position'), 20), eq(messages.field('id'), 'message-2')),
    );
    const value = plan(selection(messages).where(expression), 'forbid');
    const expected = idsOf(records.filter((record) => matches(expression, record)));

    try {
      expect(value.type).toBe('union');
      await expect(harness.executor.execute(value).then(idsOf)).resolves.toEqual(expected);
      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith(['messages'], 'readonly');
    } finally {
      harness.connection.close();
    }
  });

  it('выполняет primary, index и Union Post-filter Plans эквивалентно полному Expression', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const cases = [
      and(eq(messages.field('id'), 'message-2'), eq(messages.field('status'), 'delivered')),
      and(gt(messages.field('position'), 10), eq(messages.field('status'), 'pending')),
      and(oneOf(messages.field('position'), [10, 20, 30]), eq(messages.field('status'), 'pending')),
      and(
        or(gt(messages.field('position'), 10), lte(messages.field('position'), 20)),
        eq(messages.field('status'), 'pending'),
      ),
    ] as const;

    try {
      for (const expression of cases) {
        const value = plan(selection(messages).where(expression), 'forbid');
        const expected = idsOf(records.filter((record) => matches(expression, record)));

        expect(value.type).toBe('post-filter');
        await expect(harness.executor.execute(value).then(idsOf)).resolves.toEqual(expected);
      }

      expect(transaction).toHaveBeenCalledTimes(cases.length);
      expect(transaction.mock.calls.every(([scope, mode]) => scope[0] === 'messages' && mode === 'readonly')).toBe(
        true,
      );
    } finally {
      harness.connection.close();
    }
  });

  it('выполняет planner Intersection sources эквивалентно полному Expression в одной transaction', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const cases = [
      and(gt(messages.field('position'), 10), lte(messages.field('position'), 20)),
      and(eq(messages.field('id'), 'message-2'), eq(messages.field('position'), 20)),
      and(
        oneOf(messages.field('position'), [10, 20]),
        or(eq(messages.field('id'), 'message-2'), eq(messages.field('id'), 'message-3')),
      ),
      and(
        eq(messages.field('id'), 'message-2'),
        eq(messages.field('position'), 20),
        eq(messages.field('status'), 'delivered'),
      ),
    ] as const;

    try {
      for (const expression of cases) {
        const value = plan(selection(messages).where(expression), 'forbid');
        const expected = idsOf(records.filter((record) => matches(expression, record)));

        expect(value.type).toBe('post-filter');

        if (value.type !== 'post-filter') {
          throw new Error('Expected Post-filter Plan');
        }

        expect(value.source.type).toBe('intersection');
        await expect(harness.executor.execute(value).then(idsOf)).resolves.toEqual(expected);
      }

      expect(transaction).toHaveBeenCalledTimes(cases.length);
      expect(transaction.mock.calls.every(([scope, mode]) => scope[0] === 'messages' && mode === 'readonly')).toBe(
        true,
      );
    } finally {
      harness.connection.close();
    }
  });

  it('выполняет compound prefix и one-sided ranges без out-of-prefix records', async () => {
    const harness = await createCompoundHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const index = compoundMessages.indexes[0];
    const cases: readonly Readonly<{
      range: Range;
      expected: readonly string[];
      type: 'index' | 'primary';
    }>[] = [
      {
        type: 'primary',
        range: Range.prefix(['tenant-1']),
        expected: ['message-1', 'message-2'],
      },
      {
        type: 'index',
        range: Range.prefix(['chat-1']),
        expected: ['message-1', 'message-2'],
      },
      {
        type: 'index',
        range: withinPrefix(['chat-1'], {
          type: 'lower',
          key: ['chat-1', 20],
          boundary: 'inclusive',
        }),
        expected: ['message-2'],
      },
      {
        type: 'index',
        range: withinPrefix(['chat-1'], {
          type: 'lower',
          key: ['chat-1', 10],
          boundary: 'exclusive',
        }),
        expected: ['message-2'],
      },
      {
        type: 'index',
        range: withinPrefix(['chat-1'], {
          type: 'upper',
          key: ['chat-1', 20],
          boundary: 'inclusive',
        }),
        expected: ['message-1', 'message-2'],
      },
      {
        type: 'index',
        range: withinPrefix(['chat-1'], {
          type: 'upper',
          key: ['chat-1', 20],
          boundary: 'exclusive',
        }),
        expected: ['message-1'],
      },
    ];

    try {
      for (const entry of cases) {
        const value: Plan<typeof compoundMessages> = Object.freeze(
          entry.type === 'primary'
            ? {
                type: 'primary',
                table: compoundMessages,
                range: entry.range,
              }
            : {
                type: 'index',
                table: compoundMessages,
                index,
                range: entry.range,
              },
        );

        await expect(harness.executor.execute(value).then(idsOf)).resolves.toEqual(entry.expected);
      }

      expect(transaction).toHaveBeenCalledTimes(cases.length);
      expect(
        transaction.mock.calls.every(([scope, mode]) => scope[0] === compoundMessages.name && mode === 'readonly'),
      ).toBe(true);
    } finally {
      harness.connection.close();
    }
  });

  it('не отменяет соседнюю Union branch после stop-on-prefix', async () => {
    const harness = await createCompoundHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const index = compoundMessages.indexes[0];
    const chat1 = Object.freeze({
      type: 'index',
      table: compoundMessages,
      index,
      range: Range.prefix(['chat-1']),
    } satisfies Extract<Plan<typeof compoundMessages>, { type: 'index' }>);
    const chat2 = Object.freeze({
      type: 'index',
      table: compoundMessages,
      index,
      range: Range.prefix(['chat-2']),
    } satisfies Extract<Plan<typeof compoundMessages>, { type: 'index' }>);
    const value = Object.freeze({
      type: 'union',
      table: compoundMessages,
      plans: Object.freeze([chat1, chat2]),
    } satisfies Extract<Plan<typeof compoundMessages>, { type: 'union' }>);

    try {
      await expect(harness.executor.execute(value).then(idsOf)).resolves.toEqual([
        'message-1',
        'message-2',
        'message-3',
      ]);
      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith([compoundMessages.name], 'readonly');
    } finally {
      harness.connection.close();
    }
  });

  it('выполняет planner exact, prefix, one-sided и independent compound sources', async () => {
    const harness = await createCompoundHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const primary = and(
      eq(compoundMessages.field('tenantId'), 'tenant-1'),
      eq(compoundMessages.field('id'), 'message-2'),
    );
    const indexed = and(
      eq(compoundMessages.field('chatId'), 'chat-1'),
      between(compoundMessages.field('position'), 10, 20, {
        lower: 'exclusive',
      }),
    );
    const intersected = and(
      eq(compoundMessages.field('chatId'), 'chat-1'),
      between(compoundMessages.field('position'), 0, 30),
      eq(compoundMessages.field('status'), 'pending'),
    );
    const primaryPrefix = eq(compoundMessages.field('tenantId'), 'tenant-1');
    const indexPrefix = eq(compoundMessages.field('chatId'), 'chat-1');
    const lower = and(eq(compoundMessages.field('chatId'), 'chat-1'), gt(compoundMessages.field('position'), 10));
    const upper = and(eq(compoundMessages.field('chatId'), 'chat-1'), lte(compoundMessages.field('position'), 10));
    const prefixIntersection = and(
      eq(compoundMessages.field('chatId'), 'chat-1'),
      eq(compoundMessages.field('status'), 'pending'),
    );

    try {
      await expect(
        harness.executor.execute(plan(selection(compoundMessages).where(primary), 'forbid')).then(idsOf),
      ).resolves.toEqual(['message-2']);
      await expect(
        harness.executor.execute(plan(selection(compoundMessages).where(indexed), 'forbid')).then(idsOf),
      ).resolves.toEqual(['message-2']);
      await expect(
        harness.executor.execute(plan(selection(compoundMessages).where(intersected), 'forbid')).then(idsOf),
      ).resolves.toEqual(['message-1']);
      await expect(
        harness.executor.execute(plan(selection(compoundMessages).where(primaryPrefix), 'forbid')).then(idsOf),
      ).resolves.toEqual(['message-1', 'message-2']);
      await expect(
        harness.executor.execute(plan(selection(compoundMessages).where(indexPrefix), 'forbid')).then(idsOf),
      ).resolves.toEqual(['message-1', 'message-2']);
      await expect(
        harness.executor.execute(plan(selection(compoundMessages).where(lower), 'forbid')).then(idsOf),
      ).resolves.toEqual(['message-2']);
      await expect(
        harness.executor.execute(plan(selection(compoundMessages).where(upper), 'forbid')).then(idsOf),
      ).resolves.toEqual(['message-1']);
      await expect(
        harness.executor.execute(plan(selection(compoundMessages).where(prefixIntersection), 'forbid')).then(idsOf),
      ).resolves.toEqual(['message-1']);
      expect(transaction).toHaveBeenCalledTimes(8);
      expect(
        transaction.mock.calls.every(([scope, mode]) => scope[0] === compoundMessages.name && mode === 'readonly'),
      ).toBe(true);
    } finally {
      harness.connection.close();
    }
  });

  it('не открывает transaction для physically empty exact compound range', async () => {
    const harness = await createCompoundHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const expression = and(
      eq(compoundMessages.field('chatId'), 'chat-1'),
      between(compoundMessages.field('position'), 10, 10, {
        lower: 'exclusive',
      }),
    );

    try {
      await expect(
        harness.executor.execute(plan(selection(compoundMessages).where(expression), 'forbid')),
      ).resolves.toEqual([]);
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      harness.connection.close();
    }
  });

  it('выполняет standalone mixed Intersection Plan', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const value = intersection(
      source(plan(selection(messages).where(gt(messages.field('position'), 10)), 'forbid')),
      source(plan(selection(messages).where(lte(messages.field('position'), 20)), 'forbid')),
      union(
        source(plan(selection(messages).where(eq(messages.field('id'), 'message-1')), 'forbid')),
        source(plan(selection(messages).where(eq(messages.field('id'), 'message-2')), 'forbid')),
      ),
    );

    try {
      await expect(harness.executor.execute(value).then(idsOf)).resolves.toEqual(['message-2']);
      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith(['messages'], 'readonly');
    } finally {
      harness.connection.close();
    }
  });

  it('deduplicate-ит Union candidates до Post-filter и не раскрывает metadata', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const expression = and(
      or(gt(messages.field('position'), 10), lte(messages.field('position'), 20)),
      eq(messages.field('status'), 'pending'),
    );
    const value = plan(selection(messages).where(expression), 'forbid');

    try {
      const result = await harness.executor.execute(value);

      expect(idsOf(result)).toEqual(['message-1', 'message-3']);
      expect(result).toHaveLength(2);
      expect(result.every((record) => !('primaryKey' in record) && !('record' in record))).toBe(true);
      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith(['messages'], 'readonly');
    } finally {
      harness.connection.close();
    }
  });

  it('вычисляет Post-filter один раз после Union deduplication и Intersection', async () => {
    let evaluations = 0;
    const duplicate: MessageRecord = {
      id: 'message-1',
      position: 10,
      get status(): 'pending' {
        evaluations += 1;

        return 'pending';
      },
      text: 'first',
    };
    const openCursor = vi.fn(() => Object.freeze({}) as IDBRequest<IDBCursorWithValue | null>);
    const nativeStore = {
      openCursor,
    } as unknown as IDBObjectStore;
    const iterate = vi.fn(
      (
        open: (store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null>,
        visit: (entry: Readonly<{ record: MessageRecord; key: IDBValidKey; primaryKey: IDBValidKey }>) => void,
      ): Promise<void> => {
        open(nativeStore);
        visit(
          Object.freeze({
            record: duplicate,
            key: duplicate.id,
            primaryKey: duplicate.id,
          }),
        );

        return Promise.resolve();
      },
    );
    const scope = {
      store: vi.fn(() => ({
        iterate,
      })),
    };
    const run = vi.fn((schedule: (transaction: typeof scope) => Promise<unknown>): Promise<unknown> => schedule(scope));
    const transaction = vi.fn(() => ({
      run,
    }));
    const connection = {
      transaction,
    } as unknown as NativeConnection;
    const primary = Object.freeze({
      type: 'primary',
      table: messages,
      range: Range.only(duplicate.id),
    } satisfies MessageSource);
    const sources = [union(primary, primary), intersection(primary, primary)] as const;

    for (const source of sources) {
      const value: MessagePostFilter = Object.freeze({
        type: 'post-filter',
        table: messages,
        source,
        filter: eq(messages.field('status'), 'pending'),
      });
      const previousEvaluations = evaluations;

      await expect(new Executor(connection, IDBKeyRange).execute(value)).resolves.toEqual([duplicate]);
      expect(evaluations - previousEvaluations).toBe(1);
    }

    expect(iterate).toHaveBeenCalledTimes(4);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('выполняет nested Union Plan как associative union в одной transaction', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const nested = union(
      source(plan(selection(messages).where(eq(messages.field('id'), 'message-1')), 'forbid')),
      source(plan(selection(messages).where(eq(messages.field('id'), 'message-2')), 'forbid')),
    );
    const value = union(nested, source(plan(selection(messages).where(gt(messages.field('position'), 10)), 'forbid')));

    try {
      await expect(harness.executor.execute(value).then(idsOf)).resolves.toEqual([
        'message-1',
        'message-2',
        'message-3',
      ]);
      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith(['messages'], 'readonly');
    } finally {
      harness.connection.close();
    }
  });

  it('планирует все union cursor requests до settlement первой branch', async () => {
    const releases: (() => void)[] = [];
    const openCursor = vi.fn(() => Object.freeze({}) as IDBRequest<IDBCursorWithValue | null>);
    const nativeStore = {
      openCursor,
    } as unknown as IDBObjectStore;
    const iterate = vi.fn((open: (store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null>): Promise<void> => {
      open(nativeStore);

      return new Promise((resolve) => {
        releases.push(resolve);
      });
    });
    const scope = {
      store: vi.fn(() => ({
        iterate,
      })),
    };
    const run = vi.fn((schedule: (transaction: typeof scope) => Promise<unknown>): Promise<unknown> => schedule(scope));
    const transaction = vi.fn(() => ({
      run,
    }));
    const connection = {
      transaction,
    } as unknown as NativeConnection;
    const value = union(
      Object.freeze({
        type: 'primary',
        table: messages,
        range: Range.only('message-1'),
      }),
      Object.freeze({
        type: 'primary',
        table: messages,
        range: Range.only('message-2'),
      }),
    );
    const execution = new Executor(connection, IDBKeyRange).execute(value);

    expect(transaction).toHaveBeenCalledOnce();
    expect(openCursor).toHaveBeenCalledTimes(2);
    expect(releases).toHaveLength(2);

    releases.forEach((release) => {
      release();
    });

    await expect(execution).resolves.toEqual([]);
  });

  it('планирует все Intersection cursor requests до settlement первой branch', async () => {
    const releases: (() => void)[] = [];
    const openCursor = vi.fn(() => Object.freeze({}) as IDBRequest<IDBCursorWithValue | null>);
    const nativeStore = {
      openCursor,
    } as unknown as IDBObjectStore;
    const iterate = vi.fn((open: (store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null>): Promise<void> => {
      open(nativeStore);

      return new Promise((resolve) => {
        releases.push(resolve);
      });
    });
    const scope = {
      store: vi.fn(() => ({
        iterate,
      })),
    };
    const run = vi.fn((schedule: (transaction: typeof scope) => Promise<unknown>): Promise<unknown> => schedule(scope));
    const transaction = vi.fn(() => ({
      run,
    }));
    const connection = {
      transaction,
    } as unknown as NativeConnection;
    const value = intersection(
      Object.freeze({
        type: 'primary',
        table: messages,
        range: Range.only('message-1'),
      }),
      union(
        Object.freeze({
          type: 'primary',
          table: messages,
          range: Range.only('message-1'),
        }),
        Object.freeze({
          type: 'primary',
          table: messages,
          range: Range.only('message-2'),
        }),
      ),
    );
    const execution = new Executor(connection, IDBKeyRange).execute(value);

    expect(transaction).toHaveBeenCalledOnce();
    expect(openCursor).toHaveBeenCalledTimes(3);
    expect(releases).toHaveLength(3);

    releases.forEach((release) => {
      release();
    });

    await expect(execution).resolves.toEqual([]);
  });

  it('не открывает transaction для полностью empty compiled union', async () => {
    const transaction = vi.fn();
    const connection = {
      transaction,
    } as unknown as NativeConnection;
    const emptyRange = Range.between('message-1', 'message-1', {
      lower: 'exclusive',
    });
    const value = union(
      Object.freeze({
        type: 'primary',
        table: messages,
        range: emptyRange,
      }),
      Object.freeze({
        type: 'primary',
        table: messages,
        range: emptyRange,
      }),
    );

    await expect(new Executor(connection, IDBKeyRange).execute(value)).resolves.toEqual([]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('не открывает transaction и не вычисляет filter для physically empty Post-filter source', async () => {
    const transaction = vi.fn();
    const connection = {
      transaction,
    } as unknown as NativeConnection;
    const emptyRange = Range.between('message-1', 'message-1', {
      lower: 'exclusive',
    });
    const forgedFilter = Object.freeze({
      kind: 'expression',
    }) as unknown as Expression<'messages', MessageRecord>;
    const value: MessagePostFilter = Object.freeze({
      type: 'post-filter',
      table: messages,
      source: union(
        Object.freeze({
          type: 'primary',
          table: messages,
          range: emptyRange,
        }),
        Object.freeze({
          type: 'primary',
          table: messages,
          range: emptyRange,
        }),
      ),
      filter: forgedFilter,
    });

    await expect(new Executor(connection, IDBKeyRange).execute(value)).resolves.toEqual([]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('не открывает transaction и не вычисляет filter для physically empty Intersection child', async () => {
    const transaction = vi.fn();
    const connection = {
      transaction,
    } as unknown as NativeConnection;
    const emptyRange = Range.between('message-1', 'message-1', {
      lower: 'exclusive',
    });
    const forgedFilter = Object.freeze({
      kind: 'expression',
    }) as unknown as Expression<'messages', MessageRecord>;
    const value: MessagePostFilter = Object.freeze({
      type: 'post-filter',
      table: messages,
      source: intersection(
        Object.freeze({
          type: 'primary',
          table: messages,
          range: emptyRange,
        }),
        Object.freeze({
          type: 'primary',
          table: messages,
          range: Range.only('message-1'),
        }),
      ),
      filter: forgedFilter,
    });

    await expect(new Executor(connection, IDBKeyRange).execute(value)).resolves.toEqual([]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('компилирует все Intersection ranges до empty shortcut и transaction', async () => {
    const transaction = vi.fn();
    const connection = {
      transaction,
    } as unknown as NativeConnection;
    const emptyRange = Range.between('message-1', 'message-1', {
      lower: 'exclusive',
    });
    const value = intersection(
      Object.freeze({
        type: 'primary',
        table: messages,
        range: emptyRange,
      }),
      Object.freeze({
        type: 'primary',
        table: messages,
        range: Range.anyOf(['message-1', 'message-2']),
      }),
    );

    await expect(new Executor(connection, IDBKeyRange).execute(value)).rejects.toEqual(
      new TypeError('Range cannot be compiled to a single IndexedDB key range'),
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('компилирует все union ranges до открытия transaction', async () => {
    const transaction = vi.fn();
    const connection = {
      transaction,
    } as unknown as NativeConnection;
    const value = union(
      Object.freeze({
        type: 'primary',
        table: messages,
        range: Range.only('message-1'),
      }),
      Object.freeze({
        type: 'primary',
        table: messages,
        range: Range.anyOf(['message-2', 'message-3']),
      }),
    );

    await expect(new Executor(connection, IDBKeyRange).execute(value)).rejects.toEqual(
      new TypeError('Range cannot be compiled to a single IndexedDB key range'),
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('разрешает physical index только через deterministic compiled name', async () => {
    const harness = await createHarness();
    const value = plan(selection(messages).where(eq(messages.field('position'), 20)), 'forbid');

    try {
      expect(value.type).toBe('index');
      await expect(harness.executor.execute(value)).resolves.toEqual([records[1]]);
    } finally {
      harness.connection.close();
    }
  });

  it('выполняет source-only scan и exact filtered scan', async () => {
    const harness = await createHarness();
    const filter = and(eq(messages.field('status'), 'pending'), isMissing(messages.field('optionalCode')));
    const filteredPlan = plan(selection(messages).where(filter), 'allow');

    try {
      const all = await harness.executor.execute(plan(selection(messages), 'allow'));
      const filtered = await harness.executor.execute(filteredPlan);

      expect(idsOf(all)).toEqual(['message-1', 'message-2', 'message-3']);
      expect(idsOf(filtered)).toEqual(
        records
          .filter((record) => matches(filter, record))
          .map((record) => record.id)
          .sort(),
      );
    } finally {
      harness.connection.close();
    }
  });

  it('возвращает empty result без physical transaction', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const emptyQuery = selection(messages).where(
      between(messages.field('position'), 20, 20, {
        lower: 'exclusive',
      }),
    );

    try {
      await expect(harness.executor.execute(plan(emptyQuery, 'forbid'))).resolves.toEqual([]);
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      harness.connection.close();
    }
  });

  it('всегда открывает readonly transaction только для Plan store', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');

    try {
      await harness.executor.execute(plan(selection(messages), 'allow'));

      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith(['messages'], 'readonly');
    } finally {
      harness.connection.close();
    }
  });

  it('не выполняет scan fallback при отсутствии physical index', async () => {
    databaseSequence += 1;

    const connection = await openConnection(
      new IDBFactory(),
      createCompiledSchema({
        name: `plan-executor-missing-index-${databaseSequence}`,
        version: 1,
        stores: [
          {
            name: messages.name,
            keyPath: 'id',
            autoIncrement: false,
            indexes: [],
          },
        ],
      }),
    );

    try {
      await Writer.standalone(connection).insertMany<string>(
        messages.name,
        records.map((record) => [record]),
      );

      const value = plan(selection(messages).where(eq(messages.field('position'), 20)), 'forbid');
      const error = await new Executor(connection, IDBKeyRange).execute(value).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(QueryError);
      expect(error).toMatchObject({
        code: 'operation-failed',
        operation: 'select.getRawMany',
      });
      expect((error as Error).cause).toMatchObject({
        name: 'NotFoundError',
      });
    } finally {
      connection.close();
    }
  });

  it('маппит failure одной union branch через общую transaction boundary', async () => {
    databaseSequence += 1;

    const connection = await openConnection(
      new IDBFactory(),
      createCompiledSchema({
        name: `plan-executor-union-failure-${databaseSequence}`,
        version: 1,
        stores: [
          {
            name: messages.name,
            keyPath: 'id',
            autoIncrement: false,
            indexes: [],
          },
        ],
      }),
    );
    const transaction = vi.spyOn(connection, 'transaction');
    const value = union(
      source(plan(selection(messages).where(eq(messages.field('id'), 'message-1')), 'forbid')),
      source(plan(selection(messages).where(eq(messages.field('position'), 20)), 'forbid')),
    );

    try {
      const error = await new Executor(connection, IDBKeyRange).execute(value).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(QueryError);
      expect(error).toMatchObject({
        code: 'operation-failed',
        operation: 'select.getRawMany',
      });
      expect((error as Error).cause).toMatchObject({
        name: 'NotFoundError',
      });
      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith(['messages'], 'readonly');
    } finally {
      connection.close();
    }
  });

  it('маппит failure одной Intersection branch через общую transaction boundary', async () => {
    databaseSequence += 1;

    const connection = await openConnection(
      new IDBFactory(),
      createCompiledSchema({
        name: `plan-executor-intersection-failure-${databaseSequence}`,
        version: 1,
        stores: [
          {
            name: messages.name,
            keyPath: 'id',
            autoIncrement: false,
            indexes: [],
          },
        ],
      }),
    );
    const transaction = vi.spyOn(connection, 'transaction');
    const expression = and(eq(messages.field('id'), 'message-2'), eq(messages.field('position'), 20));
    const value = plan(selection(messages).where(expression), 'forbid');

    try {
      const error = await new Executor(connection, IDBKeyRange).execute(value).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(QueryError);
      expect(error).toMatchObject({
        code: 'operation-failed',
        operation: 'select.getRawMany',
      });
      expect((error as Error).cause).toMatchObject({
        name: 'NotFoundError',
      });
      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith(['messages'], 'readonly');
    } finally {
      connection.close();
    }
  });

  it('маппит native abort и сохраняет cause identity', async () => {
    const cause = new DOMException('Readonly transaction aborted', 'AbortError');
    const connection = {
      transaction: vi.fn(() => {
        throw cause;
      }),
    } as unknown as NativeConnection;
    const value = plan(selection(messages), 'allow');
    const error = await new Executor(connection, IDBKeyRange).execute(value).catch((reason: unknown) => reason);

    expect(error).toEqual(new QueryError('transaction-aborted', 'select.getRawMany', { cause }));
    expect((error as Error).cause).toBe(cause);
  });

  it('маппит Post-filter evaluation failure через outer query boundary', async () => {
    const harness = await createHarness();
    const transaction = vi.spyOn(harness.connection, 'transaction');
    const forgedFilter = Object.freeze({
      kind: 'expression',
    }) as unknown as Expression<'messages', MessageRecord>;
    const value: MessagePostFilter = Object.freeze({
      type: 'post-filter',
      table: messages,
      source: source(plan(selection(messages).where(eq(messages.field('id'), 'message-1')), 'forbid')),
      filter: forgedFilter,
    });

    try {
      const error = await harness.executor.execute(value).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(QueryError);
      expect(error).toMatchObject({
        code: 'operation-failed',
        operation: 'select.getRawMany',
      });
      expect((error as Error).cause).toEqual(new TypeError('Expression is invalid'));
      expect(transaction).toHaveBeenCalledOnce();
    } finally {
      harness.connection.close();
    }
  });

  it('маппит native Range failure и сохраняет compiler TypeError', async () => {
    const physicalCause = new DOMException('Native range failed', 'DataError');
    const failingKeyRange = {
      only: () => {
        throw physicalCause;
      },
    } as unknown as typeof IDBKeyRange;
    const connection = {
      transaction: vi.fn(),
    } as unknown as NativeConnection;
    const primary = plan(selection(messages).where(eq(messages.field('id'), 'message-1')), 'forbid');
    const executor = new Executor(connection, failingKeyRange);
    const physicalError = await executor.execute(primary).catch((cause: unknown) => cause);
    const invalidPlan: Plan<typeof messages> = Object.freeze({
      type: 'primary',
      table: messages,
      range: Range.anyOf(['message-1', 'message-2']),
    });
    const programmingError = await new Executor(connection, IDBKeyRange)
      .execute(invalidPlan)
      .catch((cause: unknown) => cause);

    expect(physicalError).toEqual(new QueryError('operation-failed', 'select.getRawMany', { cause: physicalCause }));
    expect((physicalError as Error).cause).toBe(physicalCause);
    expect(programmingError).toEqual(new TypeError('Range cannot be compiled to a single IndexedDB key range'));
    expect(connection.transaction).not.toHaveBeenCalled();
  });
});
