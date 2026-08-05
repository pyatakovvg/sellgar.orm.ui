import { table } from '../../schema/index.ts';
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
  matches,
  not,
  oneOf,
  or,
} from '../index.ts';
import type { Input } from '../value.ts';

interface MessageRecord {
  readonly id: string;
  readonly position: number;
  readonly status: 'delivered' | 'pending';
  readonly score: number | null;
  readonly optionalCode?: string;
  readonly metadata?: {
    readonly label?: string;
  };
  readonly flexible: Input;
  readonly title: string;
}

const messages = table('messages').record<MessageRecord>().define({
  primaryKey: 'id',
  indexes: [],
});

const record: MessageRecord = {
  id: 'message-1',
  position: 10,
  status: 'pending',
  score: null,
  metadata: {
    label: 'important',
  },
  flexible: [new Date(100), new Uint8Array([1, 2]), Number.NaN],
  title: 'hello',
};

describe('Expression record evaluator types', () => {
  it('связывает record с exact Expression contract', () => {
    const expression = eq(messages.field('status'), 'pending');

    expectTypeOf(matches(expression, record)).toEqualTypeOf<boolean>();

    if (false) {
      // @ts-expect-error record не соответствует Expression RecordType.
      matches(expression, {
        id: 'message-1',
      });
    }
  });
});

describe('Expression record evaluator', () => {
  it('использует Value equality для scalar и recursive values', () => {
    expect(matches(eq(messages.field('status'), 'pending'), record)).toBe(true);
    expect(matches(eq(messages.field('status'), 'delivered'), record)).toBe(false);
    expect(matches(eq(messages.field('flexible'), [new Date(100), new Uint8Array([1, 2]), Number.NaN]), record)).toBe(
      true,
    );
    expect(matches(eq(messages.field('flexible'), [new Date(100), new Uint8Array([1, 3]), Number.NaN]), record)).toBe(
      false,
    );
  });

  it('использует Range и IndexedDB storage ordering для ordered operators', () => {
    expect(matches(gt(messages.field('position'), 5), record)).toBe(true);
    expect(matches(gt(messages.field('position'), 10), record)).toBe(false);
    expect(matches(gte(messages.field('position'), 10), record)).toBe(true);
    expect(matches(lt(messages.field('position'), 10), record)).toBe(false);
    expect(matches(lte(messages.field('position'), 10), record)).toBe(true);
    expect(matches(between(messages.field('position'), 10, 20), record)).toBe(true);
    expect(
      matches(
        between(messages.field('position'), 10, 20, {
          lower: 'exclusive',
        }),
        record,
      ),
    ).toBe(false);

    const runtimeString = {
      ...record,
      position: 'runtime-string',
    } as unknown as MessageRecord;
    const runtimeObject = {
      ...record,
      position: {},
    } as unknown as MessageRecord;

    expect(matches(gt(messages.field('position'), 5), runtimeString)).toBe(true);
    expect(matches(gt(messages.field('position'), 5), runtimeObject)).toBe(false);
    expect(
      matches(eq(messages.field('flexible'), 'value'), {
        ...record,
        flexible: {},
      } as unknown as MessageRecord),
    ).toBe(false);
  });

  it('выполняет oneOf, включая empty set', () => {
    expect(matches(oneOf(messages.field('status'), ['delivered', 'pending']), record)).toBe(true);
    expect(matches(oneOf(messages.field('status'), ['delivered']), record)).toBe(false);
    expect(matches(oneOf(messages.field('status'), []), record)).toBe(false);
  });

  it('различает missing, explicit undefined и null', () => {
    expect(matches(isMissing(messages.field('optionalCode')), record)).toBe(true);
    expect(
      matches(isMissing(messages.field('optionalCode')), {
        ...record,
        optionalCode: undefined,
      }),
    ).toBe(true);
    expect(
      matches(isMissing(messages.field('optionalCode')), {
        ...record,
        optionalCode: 'value',
      }),
    ).toBe(false);
    expect(
      matches(isMissing(messages.field('optionalCode')), {
        ...record,
        optionalCode: null,
      } as unknown as MessageRecord),
    ).toBe(false);
    expect(matches(isNull(messages.field('score')), record)).toBe(true);
    expect(
      matches(isNull(messages.field('score')), {
        ...record,
        score: 0,
      }),
    ).toBe(false);
    expect(
      matches(isNull(messages.field('score')), {
        ...record,
        score: undefined,
      } as unknown as MessageRecord),
    ).toBe(false);
  });

  it('читает nested paths и считает прерванный path missing', () => {
    expect(matches(eq(messages.field('metadata.label'), 'important'), record)).toBe(true);
    expect(matches(isMissing(messages.field('metadata.label')), record)).toBe(false);
    expect(
      matches(isMissing(messages.field('metadata.label')), {
        ...record,
        metadata: {},
      }),
    ).toBe(true);
    expect(
      matches(isMissing(messages.field('metadata.label')), {
        ...record,
        metadata: null,
      } as unknown as MessageRecord),
    ).toBe(true);
    expect(matches(eq(messages.field('title.length'), 5), record)).toBe(true);
  });

  it('выполняет logical expressions с short-circuit', () => {
    const accessed: string[] = [];
    const shortCircuitRecord = {
      ...record,
      get position(): number {
        accessed.push('position');
        return 10;
      },
    };
    const pending = eq(messages.field('status'), 'pending');
    const position = gt(messages.field('position'), 5);

    expect(matches(or(pending, position), shortCircuitRecord)).toBe(true);
    expect(accessed).toEqual([]);
    expect(matches(and(eq(messages.field('status'), 'delivered'), position), shortCircuitRecord)).toBe(false);
    expect(accessed).toEqual([]);
    expect(matches(not(eq(messages.field('status'), 'delivered')), shortCircuitRecord)).toBe(true);
  });

  it('отклоняет forged Expression существующей ownership validation', () => {
    const forged = Object.freeze({
      kind: 'comparison',
    }) as unknown as Expression<'messages', MessageRecord>;

    expect(() => matches(forged, record)).toThrow(new TypeError('Expression is invalid'));
  });
});
