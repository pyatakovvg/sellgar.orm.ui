import { table } from '../../schema';
import { definitionOf, Expression } from '../expression.ts';
import { between, eq, gt, gte, isMissing, isNull, lt, lte, oneOf } from '../operators.ts';
import type { BetweenOptions } from '../../range';
import type { Input } from '../value.ts';

interface RecordValue {
  readonly id: string;
  readonly position: number;
  readonly status: 'delivered' | 'pending';
  readonly delivered: boolean;
  readonly revision: bigint;
  readonly score: number | null;
  readonly optionalCode?: string;
  readonly createdAt: Date;
  readonly payload: ArrayBuffer;
  readonly flags: readonly boolean[];
  readonly flexible: Input;
  readonly metadata: {
    readonly label: string;
  };
  readonly unsafe: any;
  readonly uncertain: unknown;
}

const messages = table('messages').record<RecordValue>().define({
  primaryKey: 'id',
  indexes: [],
});

const archive = table('archive').record<RecordValue>().define({
  primaryKey: 'id',
  indexes: [],
});

describe('comparison Expression types', () => {
  it('выводит table-bound Expression из field и value', () => {
    const expressions = [
      eq(messages.field('status'), 'pending'),
      eq(messages.field('delivered'), true),
      eq(messages.field('revision'), 10n),
      eq(messages.field('flags'), [true, false]),
      eq(messages.field('score'), 10),
      gt(messages.field('position'), 1),
      gt(messages.field('score'), 1),
      gte(messages.field('createdAt'), new Date(100)),
      lt(messages.field('id'), 'z'),
      lt(messages.field('optionalCode'), 'z'),
      lte(messages.field('payload'), new Uint8Array([9]).buffer),
      between(messages.field('position'), 1, 10),
      oneOf(messages.field('status'), ['pending', 'delivered']),
      isNull(messages.field('score')),
      isMissing(messages.field('optionalCode')),
    ];

    for (const expression of expressions) {
      expectTypeOf(expression).toMatchTypeOf<Expression<'messages', RecordValue>>();
      expect(expression.kind).toBe('comparison');
    }
  });

  it('отклоняет incompatible values и fields compile-time', () => {
    const assertTypeErrors = (): void => {
      // @ts-expect-error value не входит в literal union field.
      eq(messages.field('status'), 'unknown');
      // @ts-expect-error wrong field value type.
      eq(messages.field('position'), '1');
      // @ts-expect-error null имеет отдельный operator.
      eq(messages.field('score'), null);
      // @ts-expect-error undefined имеет отдельный operator.
      eq(messages.field('optionalCode'), undefined);
      // @ts-expect-error plain object не входит в equality Value.
      eq(messages.field('metadata'), { label: 'value' });
      // @ts-expect-error any не создаёт доказанный value contract.
      eq(messages.field('unsafe'), 'value');
      // @ts-expect-error boolean не является ordered storage value.
      gt(messages.field('delivered'), true);
      // @ts-expect-error bigint не является ordered storage value.
      gt(messages.field('revision'), 1n);
      // @ts-expect-error boolean array не является ordered storage value.
      gt(messages.field('flags'), [false]);
      // @ts-expect-error boundaries сохраняют один storage type.
      between(messages.field('position'), 1, '10');
      // @ts-expect-error oneOf values имеют type field.
      oneOf(messages.field('status'), ['pending', 'unknown']);
      // @ts-expect-error non-nullable field не поддерживает isNull.
      isNull(messages.field('id'));
      // @ts-expect-error required field не поддерживает isMissing.
      isMissing(messages.field('id'));
      // @ts-expect-error any не доказывает nullable field.
      isNull(messages.field('unsafe'));
      // @ts-expect-error any не доказывает missing field.
      isMissing(messages.field('unsafe'));
      // @ts-expect-error unknown не доказывает nullable field.
      isNull(messages.field('uncertain'));
      // @ts-expect-error unknown не доказывает missing field.
      isMissing(messages.field('uncertain'));

      // @ts-expect-error Expression другой table несовместим.
      const local: Expression<'messages', RecordValue> = eq(archive.field('id'), 'archive-1');
      // @ts-expect-error Expression нельзя подделать структурно.
      const forged: Expression<'messages', RecordValue> = {
        kind: 'comparison',
      };
      class ForgedExpression extends Expression<'messages', RecordValue> {
        public readonly kind = 'comparison';

        public constructor() {
          // @ts-expect-error internal creation token недоступен consumer.
          super();
        }
      }

      expect(local).toBeDefined();
      expect(forged).toBeDefined();
      expect(ForgedExpression).toBeDefined();
    };
    void assertTypeErrors;

    expect(true).toBe(true);
  });
});

describe('comparison Expression', () => {
  it('создаёт immutable eq definition с field identity', () => {
    const expression = eq(messages.field('status'), 'pending');
    const definition = definitionOf(expression);

    expect(definition).toEqual({
      type: 'comparison',
      operator: 'eq',
      field: {
        tableName: 'messages',
        path: 'status',
      },
      value: 'pending',
    });
    expect(Object.isFrozen(expression)).toBe(true);
    expect(Object.isFrozen(definition)).toBe(true);

    if (definition.type !== 'comparison') {
      throw new Error('Expected comparison definition');
    }

    expect(Object.isFrozen(definition.field)).toBe(true);
  });

  it('создаёт ordered definitions через Range semantics', () => {
    expect(definitionOf(gt(messages.field('position'), 10))).toMatchObject({
      operator: 'gt',
      value: 10,
    });
    expect(definitionOf(gte(messages.field('position'), 10))).toMatchObject({
      operator: 'gte',
      value: 10,
    });
    expect(definitionOf(lt(messages.field('position'), 20))).toMatchObject({
      operator: 'lt',
      value: 20,
    });
    expect(definitionOf(lte(messages.field('position'), 20))).toMatchObject({
      operator: 'lte',
      value: 20,
    });
  });

  it('создаёт inclusive between по умолчанию и named exclusive boundaries', () => {
    expect(definitionOf(between(messages.field('position'), 10, 20))).toMatchObject({
      operator: 'between',
      lower: 10,
      upper: 20,
      lowerBoundary: 'inclusive',
      upperBoundary: 'inclusive',
    });
    expect(
      definitionOf(
        between(messages.field('position'), 10, 20, {
          lower: 'exclusive',
          upper: 'exclusive',
        }),
      ),
    ).toMatchObject({
      lowerBoundary: 'exclusive',
      upperBoundary: 'exclusive',
    });
  });

  it('переиспользует validation reversed boundaries и options', () => {
    expect(() => between(messages.field('position'), 20, 10)).toThrow(new RangeError('Range boundaries are reversed'));
    expect(() =>
      between(messages.field('position'), 10, 20, {
        upper: 'open',
      } as unknown as BetweenOptions),
    ).toThrow(new TypeError('Range boundary is invalid'));
  });

  it('создаёт deduplicated oneOf snapshot и empty expression', () => {
    const date = new Date(100);
    const bytes = new Uint8Array([1, 2]);
    const values: Input[] = [Number.NaN, Number.NaN, -0, 0, date, bytes, true, true, 1n, 1n];
    const expression = oneOf(messages.field('flexible'), values);

    date.setTime(200);
    bytes[0] = 9;
    values.splice(0, values.length);

    const definition = definitionOf(expression);

    expect(definition.operator).toBe('one-of');

    if (definition.operator === 'one-of') {
      expect(definition.values).toHaveLength(6);
      expect(Number.isNaN(definition.values[0] as number)).toBe(true);
      expect(Object.is(definition.values[1], -0)).toBe(true);
      expect(definition.values.slice(2)).toEqual([new Date(100), new Uint8Array([1, 2]).buffer, true, 1n]);
      expect(Object.isFrozen(definition.values)).toBe(true);
    }

    expect(definitionOf(oneOf(messages.field('status'), []))).toMatchObject({
      operator: 'one-of',
      values: [],
    });
  });

  it('создаёт explicit nullish expressions без comparison value', () => {
    expect(definitionOf(isNull(messages.field('score')))).toEqual({
      type: 'comparison',
      operator: 'is-null',
      field: {
        tableName: 'messages',
        path: 'score',
      },
    });
    expect(definitionOf(isMissing(messages.field('optionalCode')))).toEqual({
      type: 'comparison',
      operator: 'is-missing',
      field: {
        tableName: 'messages',
        path: 'optionalCode',
      },
    });
  });

  it('не раскрывает mutable equality state через definition', () => {
    const date = new Date(100);
    const bytes = new Uint8Array([1, 2]);
    const expression = eq(messages.field('flexible'), [date, bytes]);

    date.setTime(200);
    bytes[0] = 9;

    const first = definitionOf(expression);

    if (first.operator !== 'eq') {
      throw new Error('Expected eq definition');
    }

    const firstValue = first.value as readonly [Date, ArrayBuffer];
    firstValue[0].setTime(300);
    new Uint8Array(firstValue[1])[0] = 8;

    const second = definitionOf(expression);

    if (second.operator !== 'eq') {
      throw new Error('Expected eq definition');
    }

    const secondValue = second.value as readonly [Date, ArrayBuffer];

    expect(secondValue[0].getTime()).toBe(100);
    expect([...new Uint8Array(secondValue[1])]).toEqual([1, 2]);
  });

  it('отклоняет invalid runtime equality values', () => {
    expect(() => eq(messages.field('status'), null as unknown as 'pending')).toThrow(
      new TypeError('Expression value is invalid'),
    );
    expect(() => oneOf(messages.field('status'), [undefined as unknown as 'pending'])).toThrow(
      new TypeError('Expression value is invalid'),
    );
  });

  it('отклоняет forged runtime Field и внешнее наследование', () => {
    const field = Object.freeze({
      kind: 'field',
      tableName: 'messages',
      path: 'id',
    }) as unknown as ReturnType<typeof messages.field<'id'>>;

    expect(() => eq(field, 'message-1')).toThrow(new TypeError('Expression field is invalid'));

    class RuntimeForgedExpression extends Expression<'messages', RecordValue> {
      public readonly kind = 'comparison';

      public constructor() {
        super(Symbol('foreign') as never);
      }
    }

    expect(() => new RuntimeForgedExpression()).toThrow(new TypeError('Expression can only be created by operators'));
  });
});
