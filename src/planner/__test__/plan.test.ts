import { Range } from '../../range/index.ts';
import { table } from '../../schema/index.ts';
import type { Plan } from '../index.ts';

interface MessageRecord {
  readonly id: string;
  readonly position: number;
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

const archive = table('archive').record<MessageRecord>().define({
  primaryKey: 'id',
  indexes: [],
});

type MessagePlan = Plan<typeof messages>;
type MessageSource = Extract<MessagePlan, { type: 'primary' | 'index' | 'union' }>;
type MessageUnion = Extract<MessagePlan, { type: 'union' }>;

const primary: MessageSource = Object.freeze({
  type: 'primary',
  table: messages,
  range: Range.only('message-1'),
});

const index: MessageSource = Object.freeze({
  type: 'index',
  table: messages,
  index: messages.indexes[0],
  range: Range.only(1),
});

describe('Union Plan contract', () => {
  it('сохраняет recursive exact Table source tuple', () => {
    const nested: MessageUnion = Object.freeze({
      type: 'union',
      table: messages,
      plans: Object.freeze([primary, index] as const),
    });
    const value: MessageUnion = Object.freeze({
      type: 'union',
      table: messages,
      plans: Object.freeze([nested, primary] as const),
    });

    expectTypeOf(value.plans).toMatchTypeOf<readonly [MessageSource, MessageSource, ...MessageSource[]]>();
    expect(value.table).toBe(messages);
    expect(value.plans).toEqual([nested, primary]);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.plans)).toBe(true);
  });

  it('не принимает one-child, empty, scan или foreign Table branches', () => {
    if (false) {
      const empty: Extract<MessagePlan, { type: 'empty' }> = {
        type: 'empty',
        table: messages,
      };
      const scan: Extract<MessagePlan, { type: 'scan' }> = {
        type: 'scan',
        table: messages,
      };
      const foreign: Extract<Plan<typeof archive>, { type: 'primary' }> = {
        type: 'primary',
        table: archive,
        range: Range.only('message-1'),
      };

      const oneChild: MessageUnion = {
        type: 'union',
        table: messages,
        // @ts-expect-error union требует минимум две source branches.
        plans: [primary],
      };
      const emptyChild: MessageUnion = {
        type: 'union',
        table: messages,
        // @ts-expect-error empty не является union source.
        plans: [primary, empty],
      };
      const scanChild: MessageUnion = {
        type: 'union',
        table: messages,
        // @ts-expect-error scan не является union source.
        plans: [primary, scan],
      };
      const foreignChild: MessageUnion = {
        type: 'union',
        table: messages,
        // @ts-expect-error foreign Table source несовместим с union root.
        plans: [primary, foreign],
      };

      expect(oneChild).toBeDefined();
      expect(emptyChild).toBeDefined();
      expect(scanChild).toBeDefined();
      expect(foreignChild).toBeDefined();
    }

    expect(true).toBe(true);
  });
});
