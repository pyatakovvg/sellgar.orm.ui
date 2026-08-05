import { schema, Schema } from '../schema.ts';
import type { SchemaTables, SchemaTableUnion } from '../schema.ts';
import { table } from '../table.ts';

interface ChatRecord {
  readonly id: string;
  readonly createdAt: Date;
}

interface MessageRecord {
  readonly id: string;
  readonly chatId: string;
  readonly position: number;
}

const chats = table('chats')
  .record<ChatRecord>()
  .define({
    primaryKey: 'id',
    indexes: [
      {
        keyPath: 'createdAt',
      },
    ],
  });

const messages = table('messages')
  .record<MessageRecord>()
  .define({
    primaryKey: 'id',
    indexes: [
      {
        keyPath: ['chatId', 'position'],
      },
    ],
  });

describe('Schema', () => {
  it('сохраняет literal database name и readonly non-empty table tuple', () => {
    const chatSchema = schema({
      name: 'ai-analytics-assistant',
      version: 1,
      tables: [chats, messages],
    });

    expectTypeOf(chatSchema).toEqualTypeOf<
      Schema<'ai-analytics-assistant', readonly [typeof chats, typeof messages]>
    >();
    expectTypeOf<SchemaTables<typeof chatSchema>>().toEqualTypeOf<readonly [typeof chats, typeof messages]>();
    expectTypeOf<SchemaTableUnion<typeof chatSchema>>().toEqualTypeOf<typeof chats | typeof messages>();
    expectTypeOf(chatSchema.version).toEqualTypeOf<1>();
  });

  it('создаёт immutable runtime value без connection и driver state', () => {
    const chatSchema = schema({
      name: 'ai-analytics-assistant',
      version: 1,
      tables: [chats, messages],
    });

    expect(chatSchema).toBeInstanceOf(Schema);
    expect(chatSchema).toMatchObject({
      kind: 'schema',
      name: 'ai-analytics-assistant',
      version: 1,
      tables: [chats, messages],
    });
    expect(Object.isFrozen(chatSchema.tables)).toBe(true);
    expect(Object.isFrozen(chatSchema)).toBe(true);
    expect(Reflect.set(chatSchema, 'version', 2)).toBe(false);
    expect('connection' in chatSchema).toBe(false);
    expect('driver' in chatSchema).toBe(false);
    expect('bindings' in chatSchema).toBe(false);
  });

  it('копирует входной tuple и не мутирует reusable tables', () => {
    const sourceTables: [typeof chats] = [chats];
    const first = schema({
      name: 'first-database',
      version: 1,
      tables: sourceTables,
    });
    const second = schema({
      name: 'second-database',
      version: 1,
      tables: [chats],
    });

    sourceTables.push(chats);

    expectTypeOf(first.tables).toEqualTypeOf<readonly [typeof chats]>();
    expect(first.tables).toEqual([chats]);
    expect(second.tables).toEqual([chats]);
    expect(first.tables).not.toBe(sourceTables);
    expect(first.tables[0]).toBe(chats);
    expect(second.tables[0]).toBe(chats);
    expect(Object.isFrozen(chats)).toBe(true);
  });

  it('отклоняет empty tables и version вне первой версии compile-time', () => {
    const dynamicTables = [chats];
    const dynamicVersion: number = 1;

    const assertTypeErrors = (): void => {
      schema({
        name: 'empty-database',
        version: 1,
        // @ts-expect-error Schema требует минимум одну таблицу.
        tables: [],
      });
      schema({
        name: 'future-database',
        // @ts-expect-error первая версия ORM принимает только literal version 1.
        version: 2,
        tables: [chats],
      });
      schema({
        name: 'dynamic-version',
        // @ts-expect-error number не доказывает literal version 1.
        version: dynamicVersion,
        tables: [chats],
      });
      schema({
        name: 'dynamic-tables',
        version: 1,
        // @ts-expect-error обычный array не доказывает non-empty tuple.
        tables: dynamicTables,
      });
    };
    void assertTypeErrors;

    expect([dynamicTables, dynamicVersion]).toHaveLength(2);
  });
});
