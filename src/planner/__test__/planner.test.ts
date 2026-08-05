import { QueryError } from '../../error/index.ts';
import {
  and,
  between,
  eq,
  Expression,
  gt,
  gte,
  isMissing,
  isNull,
  lt,
  lte,
  not,
  oneOf,
  or,
} from '../../expression/index.ts';
import type { BinaryStorageKey } from '../../key/index.ts';
import { filterOf, selection, Selection } from '../../selection/index.ts';
import { externalKey, table } from '../../schema/index.ts';
import type { SchemaTable } from '../../schema/index.ts';
import { plan } from '../index.ts';
import type { Plan, ScanPolicy } from '../index.ts';

interface MessageRecord {
  readonly id: string;
  readonly chatId: string;
  readonly position: number;
  readonly status: 'delivered' | 'pending';
  readonly text: string;
  readonly score: number | null;
  readonly optionalCode?: string;
  readonly tags: readonly string[];
}

interface CompoundRecord {
  readonly tenantId: string;
  readonly id: string;
}

interface RankedRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly category: string;
  readonly position: number;
}

interface SnapshotRecord {
  readonly id: string;
  readonly createdAt: Date;
  readonly bytes: BinaryStorageKey;
  readonly nested: readonly [string, number];
}

interface PartialRankRecord {
  readonly id: string;
  readonly group: string;
  readonly position: number;
  readonly status: string;
  readonly createdAt: Date;
}

type FlexibleValue = string | number | boolean | bigint | Date | BinaryStorageKey | readonly FlexibleValue[];

interface FlexiblePrimaryRecord {
  readonly id: FlexibleValue;
}

interface FlexibleIndexRecord {
  readonly id: string;
  readonly value: string;
}

const messages = table('messages')
  .record<MessageRecord>()
  .define({
    primaryKey: 'id',
    indexes: [
      {
        keyPath: 'id',
      },
      {
        keyPath: 'position',
      },
      {
        keyPath: 'position',
        unique: true,
      },
      {
        keyPath: ['chatId', 'position'],
      },
      {
        keyPath: 'tags',
        multiEntry: true,
      },
    ],
  });

const externalRecords = table('external-records')
  .record<MessageRecord>()
  .define({
    primaryKey: externalKey<string>(),
    indexes: [
      {
        keyPath: 'position',
      },
    ],
  });

const compoundRecords = table('compound-records')
  .record<CompoundRecord>()
  .define({
    primaryKey: ['tenantId', 'id'],
    indexes: [],
  });

const rankedRecords = table('ranked-records')
  .record<RankedRecord>()
  .define({
    primaryKey: 'id',
    indexes: [
      {
        keyPath: ['tenantId', 'position'],
      },
      {
        keyPath: ['tenantId', 'category', 'position'],
      },
      {
        keyPath: ['category', 'tenantId', 'position'],
        unique: true,
      },
    ],
  });

const primaryPriorityRecords = table('primary-priority-records')
  .record<RankedRecord>()
  .define({
    primaryKey: ['tenantId', 'position'],
    indexes: [
      {
        keyPath: ['tenantId', 'category', 'position'],
      },
    ],
  });

const snapshotRecords = table('snapshot-records')
  .record<SnapshotRecord>()
  .define({
    primaryKey: 'id',
    indexes: [
      {
        keyPath: ['createdAt', 'bytes', 'nested'],
      },
    ],
  });

const partialRankRecords = table('partial-rank-records')
  .record<PartialRankRecord>()
  .define({
    primaryKey: 'id',
    indexes: [
      {
        keyPath: ['group', 'position'],
      },
      {
        keyPath: ['group', 'status', 'createdAt', 'id'],
      },
    ],
  });

const flexiblePrimaryRecords = table('flexible-primary-records').record<FlexiblePrimaryRecord>().define({
  primaryKey: 'id',
  indexes: [],
});

const flexibleIndexRecords = table('flexible-index-records')
  .record<FlexibleIndexRecord>()
  .define({
    primaryKey: 'id',
    indexes: [
      {
        keyPath: 'value',
      },
    ],
  });

const expectScanOnly = <TableType extends SchemaTable>(value: Selection<TableType>): void => {
  expect(plan(value, 'allow').type).toBe('scan');
  expect(() => plan(value, 'forbid')).toThrow(
    expect.objectContaining({
      name: 'QueryError',
      code: 'scan-required',
      operation: 'select.getRawMany',
    }),
  );
};

const expectUnion = <TableType extends SchemaTable>(
  value: Plan<TableType>,
): Extract<Plan<TableType>, { type: 'union' }> => {
  expect(value.type).toBe('union');

  if (value.type !== 'union') {
    throw new Error('Expected Union Plan');
  }

  return value;
};

const expectPostFilter = <TableType extends SchemaTable>(
  value: Plan<TableType>,
): Extract<Plan<TableType>, { type: 'post-filter' }> => {
  expect(value.type).toBe('post-filter');

  if (value.type !== 'post-filter') {
    throw new Error('Expected Post-filter Plan');
  }

  return value;
};

const expectIntersection = <TableType extends SchemaTable>(
  value: Plan<TableType>,
): Extract<Plan<TableType>, { type: 'intersection' }> => {
  expect(value.type).toBe('intersection');

  if (value.type !== 'intersection') {
    throw new Error('Expected Intersection Plan');
  }

  return value;
};

describe('simple planner types', () => {
  it('сохраняет exact Table type во всех Plan variants', () => {
    const result = plan(selection(messages).where(gt(messages.field('position'), 0)), 'forbid');
    const postFilter = plan(
      selection(messages).where(and(eq(messages.field('id'), 'message-1'), eq(messages.field('text'), 'message'))),
      'forbid',
    );
    const intersection = plan(
      selection(messages).where(and(eq(messages.field('id'), 'message-1'), eq(messages.field('position'), 10))),
      'forbid',
    );
    const policy: ScanPolicy = 'allow';

    expectTypeOf(result).toEqualTypeOf<Plan<typeof messages>>();
    expectTypeOf(result.table).toEqualTypeOf<typeof messages>();
    expectTypeOf(postFilter).toEqualTypeOf<Plan<typeof messages>>();
    expectTypeOf(intersection).toEqualTypeOf<Plan<typeof messages>>();
    expect(policy).toBe('allow');

    if (postFilter.type === 'post-filter') {
      expectTypeOf(postFilter.table).toEqualTypeOf<typeof messages>();
      expectTypeOf(postFilter.source).toMatchTypeOf<Plan<typeof messages>>();
      expectTypeOf(postFilter.filter).toEqualTypeOf<Expression<'messages', MessageRecord>>();
    }

    if (intersection.type === 'post-filter' && intersection.source.type === 'intersection') {
      expectTypeOf(intersection.source.table).toEqualTypeOf<typeof messages>();
      expectTypeOf(intersection.source.plans).toMatchTypeOf<
        readonly [Plan<typeof messages>, Plan<typeof messages>, ...Plan<typeof messages>[]]
      >();
    }

    if (false) {
      // @ts-expect-error scan policy имеет закрытый набор значений.
      const invalid: ScanPolicy = 'auto';

      expect(invalid).toBeDefined();
    }
  });
});

describe('simple planner', () => {
  it('планирует compound prefix ordering без materializing sort', () => {
    const value = selection(rankedRecords)
      .where(eq(rankedRecords.field('tenantId'), 'tenant-1'))
      .orderBy(rankedRecords.field('category'), 'desc')
      .orderBy(rankedRecords.field('position'), 'desc');
    const result = plan(value, 'forbid');

    expect(result.type).toBe('ordered');

    if (result.type !== 'ordered') {
      throw new Error('Expected ordered Plan');
    }

    expect(result.access.type).toBe('index');
    expect(result.access.type === 'index' && result.access.index).toBe(rankedRecords.indexes[1]);
    expect(result.direction).toBe('desc');
    expect(result.range?.includes(['tenant-1', 'category', 10])).toBe(true);
    expect(result.range?.includes(['tenant-2', 'category', 10])).toBe(false);
    expect(result.filter).toBe(filterOf(value));
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('ограничивает compound ordering one-sided boundary и сохраняет takeLast', () => {
    const value = selection(rankedRecords)
      .where(eq(rankedRecords.field('tenantId'), 'tenant-1'))
      .where(lt(rankedRecords.field('category'), 'middle'))
      .orderBy(rankedRecords.field('category'), 'asc')
      .orderBy(rankedRecords.field('position'), 'asc')
      .takeLast(20);
    const result = plan(value, 'forbid');

    expect(result.type).toBe('ordered');

    if (result.type !== 'ordered') {
      throw new Error('Expected ordered Plan');
    }

    expect(result.range?.includes(['tenant-1', 'before', 10])).toBe(true);
    expect(result.range?.includes(['tenant-1', 'middle', 10])).toBe(false);
    expect(result.range?.includes(['tenant-2', 'before', 10])).toBe(false);
    expect(result.takeLast).toBe(20);
  });

  it('планирует source ordering по primary или index и требует scan policy для post-filter', () => {
    const primary = plan(selection(messages).orderBy(messages.field('id'), 'asc'), 'forbid');
    const indexed = plan(selection(messages).orderBy(messages.field('position'), 'desc'), 'forbid');
    const filtered = selection(messages)
      .where(eq(messages.field('text'), 'message'))
      .orderBy(messages.field('position'), 'asc');

    expect(primary.type).toBe('ordered');
    expect(primary.type === 'ordered' && primary.access.type).toBe('primary');
    expect(indexed.type).toBe('ordered');
    expect(indexed.type === 'ordered' && indexed.access.type).toBe('index');
    expect(() => plan(filtered, 'forbid')).toThrow(new QueryError('scan-required', 'select.getRawMany'));
    expect(plan(filtered, 'allow').type).toBe('ordered');
  });

  it('отклоняет mixed direction и ordering без подходящего key path', () => {
    const mixed = selection(rankedRecords)
      .where(eq(rankedRecords.field('tenantId'), 'tenant-1'))
      .orderBy(rankedRecords.field('category'), 'asc')
      .orderBy(rankedRecords.field('position'), 'desc');
    const unsupported = selection(messages).orderBy(messages.field('text'), 'asc');

    expect(() => plan(mixed, 'forbid')).toThrow(new QueryError('unsupported-order', 'select.getRawMany'));
    expect(() => plan(unsupported, 'allow')).toThrow(new QueryError('unsupported-order', 'select.getRawMany'));
  });

  it('выбирает simple record primary раньше secondary index того же path', () => {
    const result = plan(selection(messages).where(eq(messages.field('id'), 'message-1')), 'forbid');

    expect(result.type).toBe('primary');
    expect(result.table).toBe(messages);
    expect(Object.isFrozen(result)).toBe(true);

    if (result.type !== 'primary') {
      throw new Error('Expected primary plan');
    }

    expect(result.range.includes('message-1')).toBe(true);
    expect(result.range.includes('message-2')).toBe(false);
    expect(Object.isFrozen(result.range)).toBe(true);
  });

  it('выбирает первый eligible secondary index по declaration order', () => {
    const result = plan(selection(messages).where(gt(messages.field('position'), 10)), 'forbid');

    expect(result.type).toBe('index');
    expect(result.table).toBe(messages);

    if (result.type !== 'index') {
      throw new Error('Expected index plan');
    }

    expect(result.index).toBe(messages.indexes[1]);
    expect(result.index).not.toBe(messages.indexes[2]);
    expect(result.range.includes(10)).toBe(false);
    expect(result.range.includes(11)).toBe(true);
  });

  it('не превращает allow в принудительный scan при доступном index', () => {
    expect(plan(selection(messages).where(gt(messages.field('position'), 0)), 'allow').type).toBe('index');
  });

  it('создаёт immutable Empty Plan только для top-level oneOf без values', () => {
    const expression = oneOf(messages.field('position'), []);
    const value = selection(messages).where(expression);
    const forbidden = plan(value, 'forbid');
    const allowed = plan(value, 'allow');

    expect(forbidden).toEqual({
      type: 'empty',
      table: messages,
    });
    expect(allowed).toEqual({
      type: 'empty',
      table: messages,
    });
    expect(forbidden.table).toBe(messages);
    expect(Object.isFrozen(forbidden)).toBe(true);
    expect(Object.isFrozen(allowed)).toBe(true);
    expect(Reflect.ownKeys(value)).toEqual(['kind']);
  });

  it('нормализует singleton oneOf в обычный primary или index Plan', () => {
    const primary = plan(selection(messages).where(oneOf(messages.field('id'), ['message-1'])), 'forbid');
    const indexed = plan(selection(messages).where(oneOf(messages.field('position'), [10, 10])), 'forbid');

    expect(primary.type).toBe('primary');
    expect(indexed.type).toBe('index');

    if (primary.type !== 'primary' || indexed.type !== 'index') {
      throw new Error('Expected point source Plans');
    }

    expect(primary.range.includes('message-1')).toBe(true);
    expect(indexed.index).toBe(messages.indexes[1]);
    expect(indexed.range.includes(10)).toBe(true);
    expect(Object.isFrozen(primary)).toBe(true);
    expect(Object.isFrozen(indexed)).toBe(true);
  });

  it('создаёт immutable primary и index unions с существующим source priority', () => {
    const primary = expectUnion(
      plan(selection(messages).where(oneOf(messages.field('id'), ['message-2', 'message-1'])), 'forbid'),
    );
    const indexed = expectUnion(plan(selection(messages).where(oneOf(messages.field('position'), [20, 10, 30])), 'forbid'));

    expect(primary.plans).toHaveLength(2);
    expect(primary.plans.every((point) => point.type === 'primary')).toBe(true);
    expect(primary.plans.map((point) => point.type === 'primary' && point.range.includes('message-2'))).toEqual([
      true,
      false,
    ]);
    expect(primary.plans.map((point) => point.type === 'primary' && point.range.includes('message-1'))).toEqual([
      false,
      true,
    ]);
    expect(indexed.plans).toHaveLength(3);
    expect(indexed.plans.every((point) => point.type === 'index')).toBe(true);
    expect(indexed.plans.every((point) => point.type === 'index' && point.index === messages.indexes[1])).toBe(true);
    expect(new Set(indexed.plans.flatMap((point) => (point.type === 'union' ? [] : [point.range]))).size).toBe(3);
    expect(indexed.plans.every(Object.isFrozen)).toBe(true);
    expect(
      indexed.plans.every(
        (point) => (point.type === 'primary' || point.type === 'index') && Object.isFrozen(point.range),
      ),
    ).toBe(true);
    expect(Object.isFrozen(primary)).toBe(true);
    expect(Object.isFrozen(primary.plans)).toBe(true);
    expect(Object.isFrozen(indexed)).toBe(true);
    expect(Object.isFrozen(indexed.plans)).toBe(true);
    expect(plan(selection(messages).where(oneOf(messages.field('position'), [10, 20])), 'allow').type).toBe('union');
  });

  it('планирует snapshot Date, binary и compound array keys', () => {
    const date = new Date(100);
    const bytes = new Uint8Array([1, 2]);
    const compound: [string, number] = ['tenant', 1];
    const expression = oneOf(flexiblePrimaryRecords.field('id'), [date, bytes, compound]);

    date.setTime(200);
    bytes[0] = 9;
    compound[0] = 'mutation';
    compound[1] = 2;

    const value = expectUnion(plan(selection(flexiblePrimaryRecords).where(expression), 'forbid'));

    expect(value.plans).toHaveLength(3);
    expect(value.plans[0].type === 'primary' && value.plans[0].range.includes(new Date(100))).toBe(true);
    expect(value.plans[1].type === 'primary' && value.plans[1].range.includes(new Uint8Array([1, 2]))).toBe(true);
    expect(value.plans[2].type === 'primary' && value.plans[2].range.includes(['tenant', 1])).toBe(true);
  });

  it('отбрасывает физически невозможные non-key record primary values', () => {
    const mixed = expectUnion(
      plan(
        selection(flexiblePrimaryRecords).where(
          oneOf(flexiblePrimaryRecords.field('id'), ['record-1', true, 1n, Number.NaN, ['nested', true], 'record-2']),
        ),
        'forbid',
      ),
    );
    const impossible = selection(flexiblePrimaryRecords).where(
      oneOf(flexiblePrimaryRecords.field('id'), [true, 1n, Number.NaN, ['nested', true]]),
    );

    expect(mixed.plans).toHaveLength(2);
    expect(mixed.plans[0].type === 'primary' && mixed.plans[0].range.includes('record-1')).toBe(true);
    expect(mixed.plans[1].type === 'primary' && mixed.plans[1].range.includes('record-2')).toBe(true);
    expect(plan(impossible, 'forbid')).toEqual({
      type: 'empty',
      table: flexiblePrimaryRecords,
    });
    expect(plan(impossible, 'allow')).toEqual({
      type: 'empty',
      table: flexiblePrimaryRecords,
    });
  });

  it('не строит partial secondary union при наличии non-key values', () => {
    const mixedExpression = oneOf(flexibleIndexRecords.field('value'), ['record-1', true as unknown as string]);
    const nonKeyExpression = oneOf(flexibleIndexRecords.field('value'), [
      true as unknown as string,
      1n as unknown as string,
      Number.NaN as unknown as string,
      ['nested', true] as unknown as string,
    ]);
    const mixedQuery = selection(flexibleIndexRecords).where(mixedExpression);
    const nonKeyQuery = selection(flexibleIndexRecords).where(nonKeyExpression);
    const mixedScan = plan(mixedQuery, 'allow');
    const nonKeyScan = plan(nonKeyQuery, 'allow');

    expect(() => plan(mixedQuery, 'forbid')).toThrow(new QueryError('scan-required', 'select.getRawMany'));
    expect(() => plan(nonKeyQuery, 'forbid')).toThrow(new QueryError('scan-required', 'select.getRawMany'));
    expect(mixedScan).toEqual({
      type: 'scan',
      table: flexibleIndexRecords,
      filter: mixedExpression,
    });
    expect(nonKeyScan).toEqual({
      type: 'scan',
      table: flexibleIndexRecords,
      filter: nonKeyExpression,
    });

    if (mixedScan.type !== 'scan' || nonKeyScan.type !== 'scan') {
      throw new Error('Expected exact scan Plans');
    }

    expect(mixedScan.filter).toBe(mixedExpression);
    expect(nonKeyScan.filter).toBe(nonKeyExpression);
  });

  it('строит immutable logical or Union из primary и index branches', () => {
    const expression = or(
      eq(messages.field('id'), 'message-1'),
      gt(messages.field('position'), 10),
      eq(messages.field('position'), 5),
    );
    const forbidden = expectUnion(plan(selection(messages).where(expression), 'forbid'));
    const allowed = expectUnion(plan(selection(messages).where(expression), 'allow'));

    expect(forbidden.plans.map((branch) => branch.type)).toEqual(['primary', 'index', 'index']);
    expect(allowed.plans.map((branch) => branch.type)).toEqual(['primary', 'index', 'index']);
    expect(forbidden.plans.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(forbidden)).toBe(true);
    expect(Object.isFrozen(forbidden.plans)).toBe(true);

    const [primary, greater, exact] = forbidden.plans;

    if (primary.type !== 'primary' || greater.type !== 'index' || exact.type !== 'index') {
      throw new Error('Expected mixed exact Union branches');
    }

    expect(primary.range.includes('message-1')).toBe(true);
    expect(greater.index).toBe(messages.indexes[1]);
    expect(greater.range.includes(10)).toBe(false);
    expect(greater.range.includes(11)).toBe(true);
    expect(exact.index).toBe(messages.indexes[1]);
    expect(exact.range.includes(5)).toBe(true);
    expect(Reflect.ownKeys(expression)).toEqual(['kind']);
  });

  it('сохраняет nested Union для indexed oneOf и nested logical or', () => {
    const oneOfBranch = expectUnion(
      plan(
        selection(messages).where(or(oneOf(messages.field('position'), [10, 20]), eq(messages.field('id'), 'message-3'))),
        'forbid',
      ),
    );
    const logicalBranch = expectUnion(
      plan(
        selection(messages).where(
          or(
            eq(messages.field('id'), 'message-1'),
            or(eq(messages.field('position'), 20), eq(messages.field('id'), 'message-3')),
          ),
        ),
        'forbid',
      ),
    );

    expect(oneOfBranch.plans.map((branch) => branch.type)).toEqual(['union', 'primary']);
    expect(logicalBranch.plans.map((branch) => branch.type)).toEqual(['primary', 'union']);
    expect(oneOfBranch.plans[0].type === 'union' && oneOfBranch.plans[0].plans).toHaveLength(2);
    expect(logicalBranch.plans[1].type === 'union' && logicalBranch.plans[1].plans).toHaveLength(2);
    expect(Object.isFrozen(oneOfBranch.plans[0])).toBe(true);
    expect(Object.isFrozen(logicalBranch.plans[1])).toBe(true);
  });

  it('нормализует Empty branches logical or как neutral false', () => {
    const empty = oneOf(messages.field('position'), []);
    const primary = eq(messages.field('id'), 'message-1');
    const indexed = eq(messages.field('position'), 10);
    const allEmpty = or(empty, oneOf(messages.field('id'), []));
    const singleton = plan(selection(messages).where(or(empty, primary)), 'forbid');
    const multiple = expectUnion(plan(selection(messages).where(or(empty, primary, indexed)), 'forbid'));

    expect(plan(selection(messages).where(allEmpty), 'forbid')).toEqual({
      type: 'empty',
      table: messages,
    });
    expect(plan(selection(messages).where(allEmpty), 'allow')).toEqual({
      type: 'empty',
      table: messages,
    });
    expect(singleton.type).toBe('primary');
    expect(multiple.plans.map((branch) => branch.type)).toEqual(['primary', 'index']);
  });

  it('использует primary-only non-key oneOf как Empty logical or branch', () => {
    const expression = or(
      oneOf(flexiblePrimaryRecords.field('id'), [true, 1n, ['nested', true]]),
      eq(flexiblePrimaryRecords.field('id'), 'record-1'),
    );
    const result = plan(selection(flexiblePrimaryRecords).where(expression), 'forbid');

    expect(result.type).toBe('primary');

    if (result.type !== 'primary') {
      throw new Error('Expected primary Plan after Empty branch removal');
    }

    expect(result.range.includes('record-1')).toBe(true);
  });

  it('переводит весь logical or в exact full scan при любой scan-required branch', () => {
    const exact = eq(messages.field('id'), 'message-1');
    const expressions = [
      or(exact, eq(messages.field('text'), 'message')),
      or(exact, and(eq(messages.field('id'), 'message-2'), eq(messages.field('position'), 20))),
      or(exact, not(eq(messages.field('position'), 10))),
      or(exact, isNull(messages.field('score'))),
      or(exact, isMissing(messages.field('optionalCode'))),
      or(exact, eq(messages.field('tags'), ['important'])),
      or(exact, eq(messages.field('position'), true as unknown as number)),
    ] as const;

    for (const expression of expressions) {
      const value = selection(messages).where(expression);
      const result = plan(value, 'allow');

      expect(() => plan(value, 'forbid')).toThrow(new QueryError('scan-required', 'select.getRawMany'));
      expect(result.type).toBe('scan');

      if (result.type !== 'scan') {
        throw new Error('Expected full scan Plan');
      }

      expect(result.filter).toBe(expression);
    }

    expectScanOnly(
      selection(externalRecords).where(
        or(eq(externalRecords.field('id'), 'message-1'), eq(externalRecords.field('id'), 'message-2')),
      ),
    );
    expectScanOnly(
      selection(compoundRecords).where(
        or(eq(compoundRecords.field('tenantId'), 'tenant-1'), eq(compoundRecords.field('id'), 'record-1')),
      ),
    );
  });

  it('не строит logical or partial union для secondary oneOf с non-key value', () => {
    const expression = or(
      eq(flexibleIndexRecords.field('id'), 'record-1'),
      oneOf(flexibleIndexRecords.field('value'), ['value', true as unknown as string]),
    );
    const value = selection(flexibleIndexRecords).where(expression);
    const result = plan(value, 'allow');

    expect(() => plan(value, 'forbid')).toThrow(new QueryError('scan-required', 'select.getRawMany'));
    expect(result.type).toBe('scan');

    if (result.type !== 'scan') {
      throw new Error('Expected exact full scan Plan');
    }

    expect(result.filter).toBe(expression);
  });

  it('создаёт immutable Post-filter Plan из единственного primary или index source', () => {
    const primaryExpression = and(eq(messages.field('id'), 'message-1'), eq(messages.field('text'), 'message'));
    const indexExpression = and(gt(messages.field('position'), 10), isNull(messages.field('score')));
    const primary = expectPostFilter(plan(selection(messages).where(primaryExpression), 'forbid'));
    const index = expectPostFilter(plan(selection(messages).where(indexExpression), 'allow'));

    expect(primary.table).toBe(messages);
    expect(primary.filter).toBe(primaryExpression);
    expect(primary.source.type).toBe('primary');
    expect(index.table).toBe(messages);
    expect(index.filter).toBe(indexExpression);
    expect(index.source.type).toBe('index');
    expect(Object.isFrozen(primary)).toBe(true);
    expect(Object.isFrozen(primary.source)).toBe(true);
    expect(Object.isFrozen(primary.filter)).toBe(true);
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.source)).toBe(true);
    expect(Object.isFrozen(index.filter)).toBe(true);
  });

  it('строит existing Primary Plan для exact compound record key', () => {
    const expression = and(
      eq(compoundRecords.field('tenantId'), 'tenant-1'),
      eq(compoundRecords.field('id'), 'record-1'),
    );
    const result = expectPostFilter(plan(selection(compoundRecords).where(expression), 'forbid'));

    expect(result.filter).toBe(expression);
    expect(result.source.type).toBe('primary');

    if (result.source.type !== 'primary') {
      throw new Error('Expected compound primary source');
    }

    expect(result.source.range.includes(['tenant-1', 'record-1'])).toBe(true);
    expect(result.source.range.includes(['tenant-1', 'record-2'])).toBe(false);
    expect(Object.isFrozen(result.source.range)).toBe(true);
  });

  it('строит compound Index Plan и заменяет покрытый simple source', () => {
    const equality = and(eq(messages.field('chatId'), 'chat-1'), eq(messages.field('position'), 10));
    const bounded = and(
      between(messages.field('position'), 10, 20, {
        lower: 'exclusive',
        upper: 'inclusive',
      }),
      eq(messages.field('chatId'), 'chat-1'),
    );
    const exact = expectPostFilter(plan(selection(messages).where(equality), 'forbid'));
    const range = expectPostFilter(plan(selection(messages).where(bounded), 'allow'));

    expect(exact.source.type).toBe('index');
    expect(range.source.type).toBe('index');

    if (exact.source.type !== 'index' || range.source.type !== 'index') {
      throw new Error('Expected compound index sources');
    }

    expect(exact.source.index).toBe(messages.indexes[3]);
    expect(exact.source.range.includes(['chat-1', 10])).toBe(true);
    expect(range.source.index).toBe(messages.indexes[3]);
    expect(range.source.range.includes(['chat-1', 10])).toBe(false);
    expect(range.source.range.includes(['chat-1', 11])).toBe(true);
    expect(range.source.range.includes(['chat-1', 20])).toBe(true);
    expect(range.source.range.includes(['chat-1', 21])).toBe(false);
    expect(range.filter).toBe(bounded);
  });

  it('сохраняет independent source рядом с compound source в Intersection order', () => {
    const expression = and(
      eq(messages.field('id'), 'message-1'),
      eq(messages.field('chatId'), 'chat-1'),
      between(messages.field('position'), 10, 20),
    );
    const result = expectPostFilter(plan(selection(messages).where(expression), 'forbid'));
    const intersection = expectIntersection(result.source);

    expect(intersection.plans.map((source) => source.type)).toEqual(['primary', 'index']);

    const compound = intersection.plans[1];

    if (compound.type !== 'index') {
      throw new Error('Expected compound index after independent primary');
    }

    expect(compound.index).toBe(messages.indexes[3]);
    expect(compound.range.includes(['chat-1', 10])).toBe(true);
    expect(compound.range.includes(['chat-1', 20])).toBe(true);
  });

  it('выбирает compound primary, затем longest index и declaration order tie', () => {
    const primaryExpression = and(
      eq(primaryPriorityRecords.field('tenantId'), 'tenant-1'),
      eq(primaryPriorityRecords.field('category'), 'category-1'),
      eq(primaryPriorityRecords.field('position'), 10),
    );
    const indexExpression = and(
      eq(rankedRecords.field('tenantId'), 'tenant-1'),
      eq(rankedRecords.field('category'), 'category-1'),
      eq(rankedRecords.field('position'), 10),
    );
    const primary = expectPostFilter(plan(selection(primaryPriorityRecords).where(primaryExpression), 'forbid'));
    const indexed = expectPostFilter(plan(selection(rankedRecords).where(indexExpression), 'forbid'));

    expect(primary.source.type).toBe('primary');
    expect(indexed.source.type).toBe('index');

    if (primary.source.type !== 'primary' || indexed.source.type !== 'index') {
      throw new Error('Expected ranked compound sources');
    }

    expect(primary.source.range.includes(['tenant-1', 10])).toBe(true);
    expect(indexed.source.index).toBe(rankedRecords.indexes[1]);
    expect(indexed.source.index).not.toBe(rankedRecords.indexes[2]);
    expect(indexed.source.range.includes(['tenant-1', 'category-1', 10])).toBe(true);
  });

  it('выбирает exact compound match раньше любого partial match', () => {
    const expression = and(eq(rankedRecords.field('tenantId'), 'tenant-1'), eq(rankedRecords.field('position'), 10));
    const result = expectPostFilter(plan(selection(rankedRecords).where(expression), 'forbid'));

    expect(result.source.type).toBe('index');

    if (result.source.type !== 'index') {
      throw new Error('Expected exact compound index');
    }

    expect(result.source.index).toBe(rankedRecords.indexes[0]);
    expect(result.source.range.includes(['tenant-1', 10])).toBe(true);
  });

  it('ранжирует partial matches по coverage, one-sided, primary и declaration order', () => {
    const moreCoverageExpression = and(
      eq(partialRankRecords.field('group'), 'group-1'),
      gt(partialRankRecords.field('position'), 10),
      eq(partialRankRecords.field('status'), 'pending'),
      eq(partialRankRecords.field('createdAt'), new Date(100)),
    );
    const oneSidedExpression = and(
      eq(partialRankRecords.field('group'), 'group-1'),
      gt(partialRankRecords.field('position'), 10),
      eq(partialRankRecords.field('status'), 'pending'),
    );
    const primaryExpression = and(
      eq(primaryPriorityRecords.field('tenantId'), 'tenant-1'),
      eq(primaryPriorityRecords.field('id'), 'record-1'),
    );
    const declarationExpression = and(
      eq(rankedRecords.field('tenantId'), 'tenant-1'),
      eq(rankedRecords.field('category'), 'category-1'),
    );
    const moreCoverage = expectPostFilter(plan(selection(partialRankRecords).where(moreCoverageExpression), 'forbid'));
    const oneSided = expectPostFilter(plan(selection(partialRankRecords).where(oneSidedExpression), 'forbid'));
    const primary = expectPostFilter(plan(selection(primaryPriorityRecords).where(primaryExpression), 'forbid'));
    const declaration = expectPostFilter(plan(selection(rankedRecords).where(declarationExpression), 'forbid'));

    expect(moreCoverage.source.type).toBe('index');
    expect(oneSided.source.type).toBe('index');
    expect(primary.source.type).toBe('primary');
    expect(declaration.source.type).toBe('index');

    if (
      moreCoverage.source.type !== 'index' ||
      oneSided.source.type !== 'index' ||
      primary.source.type !== 'primary' ||
      declaration.source.type !== 'index'
    ) {
      throw new Error('Expected ranked partial sources');
    }

    expect(moreCoverage.source.index).toBe(partialRankRecords.indexes[1]);
    expect(oneSided.source.index).toBe(partialRankRecords.indexes[0]);
    expect(declaration.source.index).toBe(rankedRecords.indexes[1]);

    expect(primary.source.range.includes(['tenant-1', 10])).toBe(true);
  });

  it('выбирает first eq последнего component раньше between и оставляет duplicate source', () => {
    const expression = and(
      between(messages.field('position'), 10, 20),
      eq(messages.field('chatId'), 'chat-1'),
      eq(messages.field('position'), 15),
    );
    const result = expectPostFilter(plan(selection(messages).where(expression), 'forbid'));
    const intersection = expectIntersection(result.source);

    expect(intersection.plans.map((source) => source.type)).toEqual(['index', 'index']);

    const [duplicate, compound] = intersection.plans;

    if (duplicate.type !== 'index' || compound.type !== 'index') {
      throw new Error('Expected simple and compound index sources');
    }

    expect(duplicate.index).toBe(messages.indexes[1]);
    expect(duplicate.range.includes(10)).toBe(true);
    expect(duplicate.range.includes(20)).toBe(true);
    expect(compound.index).toBe(messages.indexes[3]);
    expect(compound.range.includes(['chat-1', 15])).toBe(true);
    expect(compound.range.includes(['chat-1', 10])).toBe(false);
    expect(result.filter).toBe(expression);
  });

  it('использует first matching prefix operand и flatten-ит repeated where', () => {
    const duplicate = and(
      eq(messages.field('chatId'), 'chat-1'),
      eq(messages.field('chatId'), 'chat-2'),
      eq(messages.field('position'), 10),
    );
    const repeated = selection(messages)
      .where(eq(messages.field('chatId'), 'chat-1'))
      .where(between(messages.field('position'), 10, 20));
    const nested = and(
      eq(messages.field('chatId'), 'chat-1'),
      and(eq(messages.field('text'), 'first'), between(messages.field('position'), 10, 20)),
    );
    const duplicatePlan = expectPostFilter(plan(selection(messages).where(duplicate), 'forbid'));
    const repeatedPlan = expectPostFilter(plan(repeated, 'forbid'));
    const nestedPlan = expectPostFilter(plan(selection(messages).where(nested), 'forbid'));

    expect(duplicatePlan.source.type).toBe('index');
    expect(repeatedPlan.source.type).toBe('index');
    expect(nestedPlan.source.type).toBe('index');

    if (
      duplicatePlan.source.type !== 'index' ||
      repeatedPlan.source.type !== 'index' ||
      nestedPlan.source.type !== 'index'
    ) {
      throw new Error('Expected flattened compound index sources');
    }

    expect(duplicatePlan.source.index).toBe(messages.indexes[3]);
    expect(duplicatePlan.source.range.includes(['chat-1', 10])).toBe(true);
    expect(duplicatePlan.source.range.includes(['chat-2', 10])).toBe(false);
    expect(repeatedPlan.source.index).toBe(messages.indexes[3]);
    expect(repeatedPlan.source.range.includes(['chat-1', 10])).toBe(true);
    expect(repeatedPlan.source.range.includes(['chat-1', 20])).toBe(true);
    expect(repeatedPlan.filter).toBe(filterOf(repeated));
    expect(nestedPlan.source.index).toBe(messages.indexes[3]);
    expect(nestedPlan.filter).toBe(nested);
  });

  it('snapshot-ит Date, binary и nested array compound components', () => {
    const createdAt = new Date(100);
    const bytes = new Uint8Array([1, 2]);
    const nested: [string, number] = ['nested', 1];
    const expression = and(
      eq(snapshotRecords.field('createdAt'), createdAt),
      eq(snapshotRecords.field('bytes'), bytes),
      eq(snapshotRecords.field('nested'), nested),
    );

    createdAt.setTime(200);
    bytes[0] = 9;
    nested[0] = 'mutation';
    nested[1] = 2;

    const result = expectPostFilter(plan(selection(snapshotRecords).where(expression), 'forbid'));

    expect(result.source.type).toBe('index');

    if (result.source.type !== 'index') {
      throw new Error('Expected snapshot compound index');
    }

    expect(result.source.range.includes([new Date(100), new Uint8Array([1, 2]), ['nested', 1]])).toBe(true);
    expect(result.source.range.includes([new Date(200), new Uint8Array([9, 2]), ['mutation', 2]])).toBe(false);
  });

  it('строит prefix source для одиночного top-level comparison', () => {
    const primaryExpression = eq(compoundRecords.field('tenantId'), 'tenant-1');
    const indexExpression = eq(messages.field('chatId'), 'chat-1');
    const primary = expectPostFilter(plan(selection(compoundRecords).where(primaryExpression), 'forbid'));
    const forbiddenIndex = expectPostFilter(plan(selection(messages).where(indexExpression), 'forbid'));
    const allowedIndex = expectPostFilter(plan(selection(messages).where(indexExpression), 'allow'));

    expect(primary.source.type).toBe('primary');
    expect(forbiddenIndex.source.type).toBe('index');
    expect(allowedIndex.source.type).toBe('index');
    expect(primary.filter).toBe(primaryExpression);
    expect(forbiddenIndex.filter).toBe(indexExpression);
    expect(allowedIndex.filter).toBe(indexExpression);

    if (
      primary.source.type !== 'primary' ||
      forbiddenIndex.source.type !== 'index' ||
      allowedIndex.source.type !== 'index'
    ) {
      throw new Error('Expected compound prefix sources');
    }

    expect(primary.source.range.includes(['tenant-1', 'record-1'])).toBe(true);
    expect(primary.source.range.includes(['tenant-2', 'record-1'])).toBe(false);
    expect(forbiddenIndex.source.index).toBe(messages.indexes[3]);
    expect(allowedIndex.source.index).toBe(messages.indexes[3]);
    expect(forbiddenIndex.source.range.includes(['chat-1', 10])).toBe(true);
    expect(forbiddenIndex.source.range.includes(['chat-2', 10])).toBe(false);
  });

  it('использует longest consecutive prefix и оставляет skipped components residual', () => {
    const consecutive = and(
      eq(snapshotRecords.field('createdAt'), new Date(100)),
      eq(snapshotRecords.field('bytes'), new Uint8Array([1, 2])),
    );
    const skipped = and(
      eq(snapshotRecords.field('createdAt'), new Date(100)),
      eq(snapshotRecords.field('nested'), ['nested', 1]),
    );
    const consecutivePlan = expectPostFilter(plan(selection(snapshotRecords).where(consecutive), 'forbid'));
    const skippedPlan = expectPostFilter(plan(selection(snapshotRecords).where(skipped), 'forbid'));

    expect(consecutivePlan.source.type).toBe('index');
    expect(skippedPlan.source.type).toBe('index');

    if (consecutivePlan.source.type !== 'index' || skippedPlan.source.type !== 'index') {
      throw new Error('Expected compound prefix indexes');
    }

    expect(consecutivePlan.source.range.includes([new Date(100), new Uint8Array([1, 2]), ['anything', 2]])).toBe(true);
    expect(consecutivePlan.source.range.includes([new Date(100), new Uint8Array([2, 2]), ['anything', 2]])).toBe(false);
    expect(skippedPlan.source.range.includes([new Date(100), new Uint8Array([9]), ['other', 2]])).toBe(true);
    expect(skippedPlan.source.range.includes([new Date(101), new Uint8Array([9]), ['nested', 1]])).toBe(false);
    expectScanOnly(selection(snapshotRecords).where(eq(snapshotRecords.field('nested'), ['nested', 1])));
  });

  it('строит compound one-sided range для последнего component', () => {
    const cases = [
      {
        expression: and(eq(messages.field('chatId'), 'chat-1'), gt(messages.field('position'), 10)),
        included: ['chat-1', 11],
        excluded: ['chat-1', 10],
      },
      {
        expression: and(eq(messages.field('chatId'), 'chat-1'), gte(messages.field('position'), 10)),
        included: ['chat-1', 10],
        excluded: ['chat-1', 9],
      },
      {
        expression: and(eq(messages.field('chatId'), 'chat-1'), lt(messages.field('position'), 20)),
        included: ['chat-1', 19],
        excluded: ['chat-1', 20],
      },
      {
        expression: and(eq(messages.field('chatId'), 'chat-1'), lte(messages.field('position'), 20)),
        included: ['chat-1', 20],
        excluded: ['chat-1', 21],
      },
    ] as const;

    for (const entry of cases) {
      const result = expectPostFilter(plan(selection(messages).where(entry.expression), 'forbid'));

      expect(result.source.type).toBe('index');

      if (result.source.type !== 'index') {
        throw new Error('Expected compound one-sided index');
      }

      expect(result.source.index).toBe(messages.indexes[3]);
      expect(result.source.range.includes(entry.included)).toBe(true);
      expect(result.source.range.includes(entry.excluded)).toBe(false);
      expect(result.source.range.includes(['chat-2', entry.included[1]])).toBe(false);
    }
  });

  it('не использует one-sided comparison промежуточного component', () => {
    const expression = and(
      eq(snapshotRecords.field('createdAt'), new Date(100)),
      gt(snapshotRecords.field('bytes'), new Uint8Array([1])),
      eq(snapshotRecords.field('nested'), ['nested', 1]),
    );
    const result = expectPostFilter(plan(selection(snapshotRecords).where(expression), 'forbid'));

    expect(result.source.type).toBe('index');

    if (result.source.type !== 'index') {
      throw new Error('Expected prefix-only index');
    }

    expect(result.source.range.includes([new Date(100), new Uint8Array([0]), ['other', 0]])).toBe(true);
    expect(result.source.range.includes([new Date(101), new Uint8Array([2]), ['nested', 1]])).toBe(false);
    expect(result.filter).toBe(expression);
  });

  it('сохраняет unsupported component forms как independent или residual predicates', () => {
    const nonLastBetween = expectPostFilter(
      plan(
        selection(messages).where(
          and(between(messages.field('chatId'), 'chat-1', 'chat-2'), eq(messages.field('position'), 10)),
        ),
        'forbid',
      ),
    );
    const oneSided = expectPostFilter(
      plan(
        selection(messages).where(and(eq(messages.field('chatId'), 'chat-1'), gt(messages.field('position'), 10))),
        'forbid',
      ),
    );
    const pointUnion = expectPostFilter(
      plan(
        selection(messages).where(and(eq(messages.field('chatId'), 'chat-1'), oneOf(messages.field('position'), [10, 20]))),
        'forbid',
      ),
    );
    const invalid = expectPostFilter(
      plan(
        selection(messages).where(
          and(eq(messages.field('chatId'), true as unknown as string), eq(messages.field('position'), 10)),
        ),
        'forbid',
      ),
    );

    expect(nonLastBetween.source.type).toBe('index');
    expect(oneSided.source.type).toBe('index');
    expect(pointUnion.source.type).toBe('intersection');
    expect(invalid.source.type).toBe('index');

    if (nonLastBetween.source.type === 'index' && oneSided.source.type === 'index' && invalid.source.type === 'index') {
      expect(nonLastBetween.source.index).toBe(messages.indexes[1]);
      expect(oneSided.source.index).toBe(messages.indexes[3]);
      expect(invalid.source.index).toBe(messages.indexes[1]);
    }

    if (pointUnion.source.type !== 'intersection') {
      throw new Error('Expected prefix and oneOf Intersection');
    }

    expect(pointUnion.source.plans.map((source) => source.type)).toEqual(['index', 'union']);
  });

  it('использует indexed oneOf и exact logical or Union как один candidate source', () => {
    const oneOfExpression = and(oneOf(messages.field('position'), [10, 20]), isMissing(messages.field('optionalCode')));
    const orExpression = and(
      or(eq(messages.field('id'), 'message-1'), eq(messages.field('position'), 20)),
      eq(messages.field('status'), 'pending'),
    );
    const oneOfPlan = expectPostFilter(plan(selection(messages).where(oneOfExpression), 'forbid'));
    const orPlan = expectPostFilter(plan(selection(messages).where(orExpression), 'allow'));

    expect(oneOfPlan.source.type).toBe('union');
    expect(orPlan.source.type).toBe('union');
    expect(oneOfPlan.filter).toBe(oneOfExpression);
    expect(orPlan.filter).toBe(orExpression);

    if (oneOfPlan.source.type !== 'union' || orPlan.source.type !== 'union') {
      throw new Error('Expected Union candidate sources');
    }

    expect(oneOfPlan.source.plans).toHaveLength(2);
    expect(orPlan.source.plans).toHaveLength(2);
    expect(Object.isFrozen(oneOfPlan.source.plans)).toBe(true);
    expect(Object.isFrozen(orPlan.source.plans)).toBe(true);
  });

  it('анализирует nested and и repeated where без изменения исходного Expression', () => {
    const nestedExpression = and(
      eq(messages.field('text'), 'message'),
      and(isNull(messages.field('score')), eq(messages.field('position'), 20)),
    );
    const repeated = selection(messages)
      .where(eq(messages.field('text'), 'message'))
      .where(isMissing(messages.field('optionalCode')))
      .where(eq(messages.field('id'), 'message-1'));
    const nested = expectPostFilter(plan(selection(messages).where(nestedExpression), 'forbid'));
    const repeatedFilter = filterOf(repeated);
    const repeatedPlan = expectPostFilter(plan(repeated, 'forbid'));

    expect(nested.filter).toBe(nestedExpression);
    expect(nested.source.type).toBe('index');
    expect(repeatedFilter).toBeDefined();
    expect(repeatedPlan.filter).toBe(repeatedFilter);
    expect(repeatedPlan.source.type).toBe('primary');
  });

  it('нормализует Empty в любой nested and position раньше количества sources', () => {
    const empty = oneOf(messages.field('position'), []);
    const values = [
      selection(messages).where(and(empty, eq(messages.field('id'), 'message-1'), eq(messages.field('position'), 10))),
      selection(messages).where(and(eq(messages.field('id'), 'message-1'), and(eq(messages.field('position'), 10), empty))),
      selection(messages)
        .where(eq(messages.field('id'), 'message-1'))
        .where(empty),
    ] as const;

    for (const value of values) {
      expect(plan(value, 'forbid')).toEqual({
        type: 'empty',
        table: messages,
      });
      expect(plan(value, 'allow')).toEqual({
        type: 'empty',
        table: messages,
      });
    }

    expectScanOnly(selection(messages).where(not(empty)));
  });

  it('сохраняет scan только для zero-source and', () => {
    const zero = and(eq(messages.field('status'), 'pending'), eq(messages.field('text'), 'message'));
    const value = selection(messages).where(zero);
    const result = plan(value, 'allow');

    expect(() => plan(value, 'forbid')).toThrow(new QueryError('scan-required', 'select.getRawMany'));
    expect(result.type).toBe('scan');

    if (result.type !== 'scan') {
      throw new Error('Expected full scan Plan');
    }

    expect(result.filter).toBe(zero);
  });

  it('создаёт immutable Intersection для каждого multi-source and shape', () => {
    const multiple = [
      and(eq(messages.field('id'), 'message-1'), eq(messages.field('position'), 10)),
      and(eq(messages.field('id'), 'message-1'), eq(messages.field('id'), 'message-2')),
      and(eq(messages.field('position'), 10), eq(messages.field('position'), 10)),
      and(eq(messages.field('id'), 'message-1'), oneOf(messages.field('position'), [10, 20])),
      and(
        or(eq(messages.field('id'), 'message-1'), eq(messages.field('position'), 10)),
        or(eq(messages.field('id'), 'message-2'), eq(messages.field('position'), 20)),
      ),
    ] as const;
    const expected = [
      ['primary', 'index'],
      ['primary', 'primary'],
      ['index', 'index'],
      ['primary', 'union'],
      ['union', 'union'],
    ] as const;

    for (let index = 0; index < multiple.length; index += 1) {
      const expression = multiple[index];
      const value = selection(messages).where(expression);
      const forbidden = expectPostFilter(plan(value, 'forbid'));
      const allowed = expectPostFilter(plan(value, 'allow'));
      const intersection = expectIntersection(forbidden.source);

      expect(forbidden.filter).toBe(expression);
      expect(allowed.filter).toBe(expression);
      expect(intersection.table).toBe(messages);
      expect(intersection.plans.map((source) => source.type)).toEqual(expected[index]);
      expect(Object.isFrozen(intersection)).toBe(true);
      expect(Object.isFrozen(intersection.plans)).toBe(true);
      expect(intersection.plans.every(Object.isFrozen)).toBe(true);
    }
  });

  it('flatten-ит nested and и repeated where только в Intersection source order', () => {
    const nestedExpression = and(
      eq(messages.field('id'), 'message-1'),
      and(eq(messages.field('text'), 'first'), eq(messages.field('position'), 10)),
    );
    const repeated = selection(messages)
      .where(eq(messages.field('position'), 10))
      .where(isMissing(messages.field('optionalCode')))
      .where(eq(messages.field('id'), 'message-1'));
    const nested = expectPostFilter(plan(selection(messages).where(nestedExpression), 'forbid'));
    const repeatedFilter = filterOf(repeated);
    const repeatedPlan = expectPostFilter(plan(repeated, 'forbid'));
    const nestedIntersection = expectIntersection(nested.source);
    const repeatedIntersection = expectIntersection(repeatedPlan.source);

    expect(nested.filter).toBe(nestedExpression);
    expect(nestedIntersection.plans.map((source) => source.type)).toEqual(['primary', 'index']);
    expect(repeatedFilter).toBeDefined();
    expect(repeatedPlan.filter).toBe(repeatedFilter);
    expect(repeatedIntersection.plans.map((source) => source.type)).toEqual(['index', 'primary']);
  });

  it('оставляет non-indexed logical, nullish и multiEntry operands residual', () => {
    const source = eq(messages.field('id'), 'message-1');
    const residuals = [
      eq(messages.field('text'), 'message'),
      isNull(messages.field('score')),
      isMissing(messages.field('optionalCode')),
      not(eq(messages.field('status'), 'delivered')),
      or(eq(messages.field('text'), 'first'), eq(messages.field('status'), 'pending')),
      eq(messages.field('tags'), ['important']),
    ] as const;

    for (const residual of residuals) {
      const expression = and(source, residual);
      const result = expectPostFilter(plan(selection(messages).where(expression), 'forbid'));

      expect(result.source.type).toBe('primary');
      expect(result.filter).toBe(expression);
    }

    const secondaryExpression = and(
      eq(flexibleIndexRecords.field('id'), 'record-1'),
      oneOf(flexibleIndexRecords.field('value'), ['value', true as unknown as string]),
    );
    const secondary = expectPostFilter(plan(selection(flexibleIndexRecords).where(secondaryExpression), 'forbid'));
    const externalExpression = and(
      eq(externalRecords.field('position'), 10),
      eq(externalRecords.field('id'), 'message-1'),
    );
    const external = expectPostFilter(plan(selection(externalRecords).where(externalExpression), 'forbid'));

    expect(secondary.source.type).toBe('primary');
    expect(secondary.filter).toBe(secondaryExpression);
    expect(external.source.type).toBe('index');
    expect(external.filter).toBe(externalExpression);
  });

  it('сохраняет independent source рядом с partial compound prefix', () => {
    const expression = and(eq(messages.field('id'), 'message-1'), eq(messages.field('chatId'), 'chat-1'));
    const result = expectPostFilter(plan(selection(messages).where(expression), 'forbid'));
    const intersection = expectIntersection(result.source);

    expect(intersection.plans.map((source) => source.type)).toEqual(['primary', 'index']);

    const prefix = intersection.plans[1];

    if (prefix.type !== 'index') {
      throw new Error('Expected partial compound index');
    }

    expect(prefix.index).toBe(messages.indexes[3]);
    expect(prefix.range.includes(['chat-1', 10])).toBe(true);
    expect(prefix.range.includes(['chat-2', 10])).toBe(false);
    expect(result.filter).toBe(expression);
  });

  it('создаёт scan только по explicit policy и сохраняет exact filter', () => {
    const expression = eq(messages.field('text'), 'message');
    const filtered = selection(messages).where(expression);
    const filteredPlan = plan(filtered, 'allow');
    const sourcePlan = plan(selection(messages), 'allow');

    expect(filteredPlan).toEqual({
      type: 'scan',
      table: messages,
      filter: expression,
    });
    expect(Object.isFrozen(filteredPlan)).toBe(true);
    expect(sourcePlan).toEqual({
      type: 'scan',
      table: messages,
    });
    expect(sourcePlan).not.toHaveProperty('filter');
  });

  it('требует scan для оставшихся неиндексируемых forms', () => {
    const values = [
      selection(messages),
      selection(messages).where(eq(messages.field('text'), 'message')),
      selection(messages).where(eq(messages.field('tags'), ['important'])),
      selection(messages).where(oneOf(messages.field('text'), ['first', 'second'])),
      selection(messages).where(oneOf(messages.field('tags'), [['important'], ['unread']])),
      selection(messages).where(isNull(messages.field('score'))),
      selection(messages).where(isMissing(messages.field('optionalCode'))),
      selection(messages).where(and(eq(messages.field('status'), 'pending'), eq(messages.field('text'), 'message'))),
    ] as const;

    for (const value of values) {
      expectScanOnly(value);
    }

    expectScanOnly(selection(externalRecords).where(eq(externalRecords.field('id'), 'message-1')));
    expectScanOnly(selection(externalRecords).where(oneOf(externalRecords.field('id'), ['message-1', 'message-2'])));
    expectScanOnly(selection(compoundRecords).where(oneOf(compoundRecords.field('tenantId'), ['tenant-1', 'tenant-2'])));
  });

  it('считает eq с non-key value корректным scan-only Selection', () => {
    const expression = eq(messages.field('position'), true as unknown as number);
    const value = selection(messages).where(expression);
    const result = plan(value, 'allow');

    expect(result).toEqual({
      type: 'scan',
      table: messages,
      filter: expression,
    });
    expect(() => plan(value, 'forbid')).toThrow(new QueryError('scan-required', 'select.getRawMany'));
  });

  it('отклоняет invalid policy и forged Selection', () => {
    const value = selection(messages);
    const logical = selection(messages).where(
      or(eq(messages.field('id'), 'message-1'), eq(messages.field('position'), 10)),
    );
    const forged = Object.freeze({
      kind: 'selection',
    }) as unknown as Selection<typeof messages>;
    const unsafePlan = plan as unknown as (query: Selection<typeof messages>, scan: string) => Plan<typeof messages>;

    expect(() => unsafePlan(logical, 'auto')).toThrow(new TypeError('Scan policy is invalid'));
    expect(() => plan(forged, 'allow')).toThrow(new TypeError('Selection is invalid'));
    expect(Reflect.ownKeys(value)).toEqual(['kind']);
  });
});
