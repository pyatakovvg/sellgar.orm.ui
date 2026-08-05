import { externalKey, schema, table } from '../../../../schema';
import { compileSchema } from '../schema-compiler.ts';

interface MessageRecord {
  readonly id: string;
  readonly chatId: string;
  readonly position: number;
  readonly externalId: string;
  readonly tags: readonly string[];
}

interface GeneratedRecord {
  readonly id: number;
  readonly value: string;
}

interface CompoundRecord {
  readonly tenantId: string;
  readonly id: string;
}

interface ExternalRecord {
  readonly value: string;
}

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
      },
      {
        keyPath: 'externalId',
        unique: true,
      },
      {
        keyPath: 'tags',
        multiEntry: true,
      },
    ],
  });

const generated = table('generated')
  .record<GeneratedRecord>()
  .define({
    primaryKey: {
      source: 'record',
      keyPath: 'id',
      generation: 'autoIncrement',
    },
    indexes: [],
  });

const compound = table('compound')
  .record<CompoundRecord>()
  .define({
    primaryKey: ['tenantId', 'id'],
    indexes: [],
  });

const externalAssigned = table('external-assigned').record<ExternalRecord>().define({
  primaryKey: externalKey<string>(),
  indexes: [],
});

const externalGenerated = table('external-generated')
  .record<ExternalRecord>()
  .define({
    primaryKey: externalKey({
      generation: 'autoIncrement',
    }),
    indexes: [],
  });

const chatSchema = schema({
  name: 'compiler-test',
  version: 1,
  tables: [messages, generated, compound, externalAssigned, externalGenerated],
});

describe('compileSchema', () => {
  it('компилирует tables, primary keys и indexes в physical schema', () => {
    const compiled = compileSchema(chatSchema);

    expect(compiled).toEqual({
      name: 'compiler-test',
      version: 1,
      stores: [
        {
          name: 'messages',
          keyPath: 'id',
          autoIncrement: false,
          indexes: [
            {
              name: '["chatId",false,false]',
              keyPath: 'chatId',
              unique: false,
              multiEntry: false,
            },
            {
              name: '[["chatId","position"],false,false]',
              keyPath: ['chatId', 'position'],
              unique: false,
              multiEntry: false,
            },
            {
              name: '["externalId",true,false]',
              keyPath: 'externalId',
              unique: true,
              multiEntry: false,
            },
            {
              name: '["tags",false,true]',
              keyPath: 'tags',
              unique: false,
              multiEntry: true,
            },
          ],
        },
        {
          name: 'generated',
          keyPath: 'id',
          autoIncrement: true,
          indexes: [],
        },
        {
          name: 'compound',
          keyPath: ['tenantId', 'id'],
          autoIncrement: false,
          indexes: [],
        },
        {
          name: 'external-assigned',
          keyPath: null,
          autoIncrement: false,
          indexes: [],
        },
        {
          name: 'external-generated',
          keyPath: null,
          autoIncrement: true,
          indexes: [],
        },
      ],
    });
  });

  it('возвращает immutable deterministic value', () => {
    const first = compileSchema(chatSchema);
    const second = compileSchema(chatSchema);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.stores)).toBe(true);
    expect(Object.isFrozen(first.stores[0]?.indexes)).toBe(true);
    expect(Object.isFrozen(first.stores[0]?.indexes[1]?.keyPath)).toBe(true);
    expect(Object.isFrozen(first.stores[2]?.keyPath)).toBe(true);
  });
});
