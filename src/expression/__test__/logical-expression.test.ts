import { table } from '../../schema';
import { definitionOf, Expression } from '../expression.ts';
import { and, eq, gt, isMissing, not, or } from '../operators.ts';

interface MessageRecord {
  readonly id: string;
  readonly position: number;
  readonly status: 'delivered' | 'pending';
  readonly optionalCode?: string;
  readonly createdAt: Date;
}

interface ExtendedMessageRecord extends MessageRecord {
  readonly extra: string;
}

const messages = table('messages').record<MessageRecord>().define({
  primaryKey: 'id',
  indexes: [],
});

const archive = table('archive').record<MessageRecord>().define({
  primaryKey: 'id',
  indexes: [],
});

const incompatibleMessages = table('messages').record<ExtendedMessageRecord>().define({
  primaryKey: 'id',
  indexes: [],
});

describe('logical Expression types', () => {
  it('выводит table-bound result по первому operand', () => {
    const delivered = eq(messages.field('status'), 'delivered');
    const positioned = gt(messages.field('position'), 0);

    expectTypeOf(and(delivered, positioned)).toMatchTypeOf<Expression<'messages', MessageRecord>>();
    expectTypeOf(or(delivered, positioned)).toMatchTypeOf<Expression<'messages', MessageRecord>>();
    expectTypeOf(not(delivered)).toMatchTypeOf<Expression<'messages', MessageRecord>>();
  });

  it('требует правильную arity и одну table compile-time', () => {
    const assertTypeErrors = (): void => {
      const local = eq(messages.field('id'), 'message-1');
      const foreign = eq(archive.field('id'), 'message-1');
      const incompatibleRecord = eq(incompatibleMessages.field('extra'), 'value');

      // @ts-expect-error and требует минимум два operands.
      and(local);
      // @ts-expect-error or требует минимум два operands.
      or(local);
      // @ts-expect-error and не имеет zero-operand semantics.
      and();
      // @ts-expect-error or не имеет zero-operand semantics.
      or();
      // @ts-expect-error not принимает ровно один operand.
      not(local, local);
      // @ts-expect-error второй operand принадлежит другой table.
      and(local, foreign);
      // @ts-expect-error второй operand принадлежит другой table.
      or(foreign, local);
      // @ts-expect-error один table name не делает разные record contracts совместимыми.
      and(local, incompatibleRecord);
    };
    void assertTypeErrors;

    expect(true).toBe(true);
  });
});

describe('logical Expression', () => {
  it('создаёт immutable and и or с двумя и несколькими operands', () => {
    const delivered = eq(messages.field('status'), 'delivered');
    const positioned = gt(messages.field('position'), 0);
    const missingCode = isMissing(messages.field('optionalCode'));
    const conjunction = and(delivered, positioned, missingCode);
    const disjunction = or(delivered, positioned);

    expect(conjunction.kind).toBe('logical');
    expect(disjunction.kind).toBe('logical');
    expect(Object.isFrozen(conjunction)).toBe(true);
    expect(Object.isFrozen(disjunction)).toBe(true);
    expect(definitionOf(conjunction)).toEqual({
      type: 'logical',
      operator: 'and',
      operands: [
        {
          type: 'comparison',
          operator: 'eq',
          field: {
            tableName: 'messages',
            path: 'status',
          },
          value: 'delivered',
        },
        {
          type: 'comparison',
          operator: 'gt',
          field: {
            tableName: 'messages',
            path: 'position',
          },
          value: 0,
        },
        {
          type: 'comparison',
          operator: 'is-missing',
          field: {
            tableName: 'messages',
            path: 'optionalCode',
          },
        },
      ],
    });
    expect(definitionOf(disjunction)).toMatchObject({
      type: 'logical',
      operator: 'or',
      operands: [{ operator: 'eq' }, { operator: 'gt' }],
    });
  });

  it('сохраняет exact nesting без flattening, deduplication и simplification', () => {
    const delivered = eq(messages.field('status'), 'delivered');
    const positioned = gt(messages.field('position'), 0);
    const nested = and(and(delivered, positioned), delivered);
    const duplicated = or(delivered, delivered);
    const doubleNegative = not(not(delivered));

    expect(definitionOf(nested)).toMatchObject({
      type: 'logical',
      operator: 'and',
      operands: [
        {
          type: 'logical',
          operator: 'and',
          operands: [{ operator: 'eq' }, { operator: 'gt' }],
        },
        {
          type: 'comparison',
          operator: 'eq',
        },
      ],
    });
    expect(definitionOf(duplicated)).toMatchObject({
      operator: 'or',
      operands: [{ operator: 'eq' }, { operator: 'eq' }],
    });
    expect(definitionOf(doubleNegative)).toMatchObject({
      type: 'logical',
      operator: 'not',
      operand: {
        type: 'logical',
        operator: 'not',
        operand: {
          type: 'comparison',
          operator: 'eq',
        },
      },
    });
  });

  it('создаёт recursive immutable snapshot и сохраняет порядок operands', () => {
    const delivered = eq(messages.field('status'), 'delivered');
    const positioned = gt(messages.field('position'), 0);
    const pending = eq(messages.field('status'), 'pending');
    const operands: [Expression<'messages', MessageRecord>, Expression<'messages', MessageRecord>] = [
      delivered,
      positioned,
    ];
    const expression = and(...operands);

    operands.reverse();
    operands[0] = pending;

    const first = definitionOf(expression);

    if (first.type !== 'logical' || first.operator !== 'and') {
      throw new Error('Expected and definition');
    }

    expect(first.operands.map((operand) => operand.operator)).toEqual(['eq', 'gt']);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.operands)).toBe(true);
    expect(first.operands.every((operand) => Object.isFrozen(operand))).toBe(true);
    expect(Reflect.set(first.operands, 0, definitionOf(pending))).toBe(false);

    const second = definitionOf(expression);

    if (second.type !== 'logical' || second.operator !== 'and') {
      throw new Error('Expected and definition');
    }

    expect(second.operands.map((operand) => operand.operator)).toEqual(['eq', 'gt']);
    expect(second).not.toBe(first);
    expect(second.operands).not.toBe(first.operands);
  });

  it('не раскрывает mutable comparison values через logical definition', () => {
    const createdAt = new Date(100);
    const expression = not(or(eq(messages.field('createdAt'), createdAt), eq(messages.field('status'), 'delivered')));

    createdAt.setTime(200);

    const first = definitionOf(expression);

    if (
      first.type !== 'logical' ||
      first.operator !== 'not' ||
      first.operand.type !== 'logical' ||
      first.operand.operator !== 'or'
    ) {
      throw new Error('Expected nested logical definition');
    }

    const firstDate = first.operand.operands[0];

    if (firstDate.type !== 'comparison' || firstDate.operator !== 'eq' || !(firstDate.value instanceof Date)) {
      throw new Error('Expected Date comparison');
    }

    firstDate.value.setTime(300);

    const second = definitionOf(expression);

    if (
      second.type !== 'logical' ||
      second.operator !== 'not' ||
      second.operand.type !== 'logical' ||
      second.operand.operator !== 'or'
    ) {
      throw new Error('Expected nested logical definition');
    }

    const secondDate = second.operand.operands[0];

    if (secondDate.type !== 'comparison' || secondDate.operator !== 'eq' || !(secondDate.value instanceof Date)) {
      throw new Error('Expected Date comparison');
    }

    expect(secondDate.value.getTime()).toBe(100);
  });

  it('отклоняет invalid arity, mixed tables и forged operands runtime', () => {
    type UnsafeLogical = (
      ...operands: Expression<'messages', MessageRecord>[]
    ) => Expression<'messages', MessageRecord>;

    const unsafeAnd = and as unknown as UnsafeLogical;
    const unsafeOr = or as unknown as UnsafeLogical;
    const unsafeNot = not as unknown as UnsafeLogical;
    const local = eq(messages.field('id'), 'message-1');
    const foreign = eq(archive.field('id'), 'message-1') as unknown as Expression<'messages', MessageRecord>;
    const forged = Object.freeze({
      kind: 'comparison',
    }) as unknown as Expression<'messages', MessageRecord>;

    expect(() => unsafeAnd()).toThrow(new TypeError('Logical expression requires at least two operands'));
    expect(() => unsafeAnd(local)).toThrow(new TypeError('Logical expression requires at least two operands'));
    expect(() => unsafeOr(local)).toThrow(new TypeError('Logical expression requires at least two operands'));
    expect(() => unsafeNot()).toThrow(new TypeError('Not expression requires exactly one operand'));
    expect(() => unsafeNot(local, local)).toThrow(new TypeError('Not expression requires exactly one operand'));
    expect(() => unsafeAnd(local, foreign)).toThrow(
      new TypeError('Logical expression operands belong to different tables'),
    );
    expect(() => unsafeAnd(local, forged)).toThrow(new TypeError('Expression is invalid'));
    expect(() => unsafeNot(forged)).toThrow(new TypeError('Expression is invalid'));
  });
});
