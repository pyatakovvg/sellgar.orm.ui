import { Field } from '../field.ts';
import { externalKey } from '../primary-key.ts';
import type { IndexValue } from '../table-index.ts';
import { table, Table } from '../table.ts';
import type { SchemaTable, TableKey, TableRecord } from '../table.ts';

interface MessageRecord {
  readonly id: string;
  readonly sequence: number;
  readonly chatId: string;
  readonly position: number;
  readonly author: {
    readonly id: string;
  };
  readonly tags: readonly string[];
  readonly optionalId?: string;
  readonly optionalSequence?: number;
  readonly delivered: boolean;
}

describe('Table', () => {
  it('сохраняет literal name, record и assigned key type staged construction', () => {
    const messages = table('messages')
      .record<MessageRecord>()
      .define({
        primaryKey: 'id',
        indexes: [
          {
            keyPath: 'chatId',
          },
          {
            keyPath: ['chatId', 'position'],
            unique: true,
          },
          {
            keyPath: 'tags',
            multiEntry: true,
          },
        ],
      });

    expectTypeOf(messages.name).toEqualTypeOf<'messages'>();
    expectTypeOf<TableRecord<typeof messages>>().toEqualTypeOf<MessageRecord>();
    expectTypeOf<TableKey<typeof messages>>().toEqualTypeOf<string>();
    expectTypeOf<IndexValue<(typeof messages.indexes)[0]>>().toEqualTypeOf<string>();
    expectTypeOf<IndexValue<(typeof messages.indexes)[1]>>().toEqualTypeOf<readonly [string, number]>();
    expectTypeOf<IndexValue<(typeof messages.indexes)[2]>>().toEqualTypeOf<string>();
    expectTypeOf<typeof messages.indexes.length>().toEqualTypeOf<3>();
    expectTypeOf<typeof messages>().toMatchTypeOf<SchemaTable>();
  });

  it('выводит auto-increment и external primary key types', () => {
    const events = table('events')
      .record<MessageRecord>()
      .define({
        primaryKey: {
          source: 'record',
          keyPath: 'sequence',
          generation: 'autoIncrement',
        },
        indexes: [],
      });
    const outbox = table('outbox').record<MessageRecord>().define({
      primaryKey: externalKey<readonly [string, number]>(),
      indexes: [],
    });
    const generatedOutbox = table('generated-outbox')
      .record<MessageRecord>()
      .define({
        primaryKey: externalKey({
          generation: 'autoIncrement',
        }),
        indexes: [],
      });

    expectTypeOf<TableKey<typeof events>>().toEqualTypeOf<number>();
    expectTypeOf<TableKey<typeof outbox>>().toEqualTypeOf<readonly [string, number]>();
    expectTypeOf<TableKey<typeof generatedOutbox>>().toEqualTypeOf<number>();
    expect([events.name, outbox.name, generatedOutbox.name]).toEqual(['events', 'outbox', 'generated-outbox']);
  });

  it('создаёт immutable runtime schema value и table-bound fields', () => {
    const messages = table('messages')
      .record<MessageRecord>()
      .define({
        primaryKey: {
          source: 'record',
          keyPath: 'id',
          generation: 'assigned',
        },
        indexes: [
          {
            keyPath: ['chatId', 'position'],
          },
        ],
      });
    const authorId = messages.field('author.id');

    expectTypeOf(authorId).toEqualTypeOf<Field<'messages', MessageRecord, 'author.id', string>>();
    expect(messages).toBeInstanceOf(Table);
    expect(messages).toMatchObject({
      kind: 'table',
      name: 'messages',
      primaryKey: {
        kind: 'record-primary-key',
        source: 'record',
        generation: 'assigned',
      },
    });
    expect(messages.indexes).toHaveLength(1);
    expect(messages.indexes[0]?.keyPath.kind).toBe('compound-key-path');
    expect(authorId).toMatchObject({
      kind: 'field',
      tableName: 'messages',
      path: 'author.id',
    });
    expect(Object.isFrozen(messages.primaryKey)).toBe(true);
    expect(Object.isFrozen(messages.indexes)).toBe(true);
    expect(Object.isFrozen(messages.indexes[0])).toBe(true);
    expect(Object.isFrozen(messages)).toBe(true);
    expect(Reflect.set(messages, 'name', 'archive')).toBe(false);
    expect('recordType' in messages).toBe(false);
    expect('get' in messages).toBe(false);
    expect('put' in messages).toBe(false);
    expect('connection' in messages).toBe(false);
  });

  it('поддерживает таблицу без secondary indexes через явный empty tuple', () => {
    const messages = table('messages').record<MessageRecord>().define({
      primaryKey: 'id',
      indexes: [],
    });

    expectTypeOf<typeof messages.indexes>().toEqualTypeOf<readonly []>();
    expect(messages.indexes).toEqual([]);
    expect(Object.isFrozen(messages.indexes)).toBe(true);
  });

  it('отклоняет invalid primary keys и indexes compile-time', () => {
    const assertTypeErrors = (): void => {
      // @ts-expect-error root record не может быть массивом из-за tuple semantics bulk input.
      table('array-record').record<readonly string[]>();
      // @ts-expect-error assigned record primary key должен быть non-nullable.
      table('optional-key').record<MessageRecord>().define({ primaryKey: 'optionalId', indexes: [] });
      table('optional-sequence')
        .record<MessageRecord>()
        .define({
          // @ts-expect-error auto-increment record key должен быть non-nullable.
          primaryKey: {
            source: 'record',
            keyPath: 'optionalSequence',
            generation: 'autoIncrement',
          },
          indexes: [],
        });
      table('string-auto-key')
        .record<MessageRecord>()
        .define({
          // @ts-expect-error auto-increment поддерживает только number field.
          primaryKey: {
            source: 'record',
            keyPath: 'id',
            generation: 'autoIncrement',
          },
          indexes: [],
        });
      table('invalid-index')
        .record<MessageRecord>()
        .define({
          primaryKey: 'id',
          indexes: [
            // @ts-expect-error boolean index field не является storage key.
            { keyPath: 'delivered' },
          ],
        });
      table('invalid-multi-entry')
        .record<MessageRecord>()
        .define({
          primaryKey: 'id',
          indexes: [
            // @ts-expect-error multi-entry требует array field.
            { keyPath: 'chatId', multiEntry: true },
          ],
        });
      table('compound-multi-entry')
        .record<MessageRecord>()
        .define({
          primaryKey: 'id',
          indexes: [
            // @ts-expect-error compound multi-entry запрещён.
            {
              keyPath: ['chatId', 'position'],
              multiEntry: true,
            },
          ],
        });
    };
    void assertTypeErrors;

    expect(true).toBe(true);
  });

  it('отклоняет неизвестный field через Table.field compile-time', () => {
    const messages = table('messages').record<MessageRecord>().define({
      primaryKey: 'id',
      indexes: [],
    });
    const dynamicPath: string = 'author.id';

    const assertTypeErrors = (): void => {
      // @ts-expect-error field отсутствует в MessageRecord.
      messages.field('unknown');
      // @ts-expect-error dynamic string не доказывает корректность field path.
      messages.field(dynamicPath);
    };
    void assertTypeErrors;

    expect(dynamicPath).toBe('author.id');
  });
});
