import { IDBFactory } from 'fake-indexeddb';

import { createCompiledSchema, installSchema } from '../index.ts';
import type { CompiledSchema } from '../index.ts';

const compiledSchema = createCompiledSchema({
  name: 'schema-installer-test',
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
          name: '["chatId",true,false]',
          keyPath: 'chatId',
          unique: true,
          multiEntry: false,
        },
        {
          name: '[["chatId","position"],false,false]',
          keyPath: ['chatId', 'position'],
          unique: false,
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
      name: 'compound-records',
      keyPath: ['tenantId', 'id'],
      autoIncrement: false,
      indexes: [],
    },
    {
      name: 'external-records',
      keyPath: null,
      autoIncrement: true,
      indexes: [],
    },
  ],
});

const openWithSchema = (factory: IDBFactory, schema: CompiledSchema): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(schema.name, schema.version);

    request.addEventListener('upgradeneeded', () => {
      installSchema(request.result, schema);
    });
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error);
    });
  });

describe('installSchema', () => {
  it('устанавливает compiled stores и primary key options', async () => {
    const database = await openWithSchema(new IDBFactory(), compiledSchema);

    try {
      expect(Array.from(database.objectStoreNames)).toEqual(['compound-records', 'external-records', 'messages']);

      const transaction = database.transaction(['messages', 'compound-records', 'external-records'], 'readonly');
      const messages = transaction.objectStore('messages');
      const compoundRecords = transaction.objectStore('compound-records');
      const externalRecords = transaction.objectStore('external-records');

      expect(messages.keyPath).toBe('id');
      expect(messages.autoIncrement).toBe(false);
      expect(compoundRecords.keyPath).toEqual(['tenantId', 'id']);
      expect(compoundRecords.autoIncrement).toBe(false);
      expect(externalRecords.keyPath).toBeNull();
      expect(externalRecords.autoIncrement).toBe(true);
    } finally {
      database.close();
    }
  });

  it('устанавливает независимые indexes с точными physical options', async () => {
    const database = await openWithSchema(new IDBFactory(), compiledSchema);

    try {
      const store = database.transaction('messages', 'readonly').objectStore('messages');

      expect(Array.from(store.indexNames).sort()).toEqual(
        [
          '["chatId",false,false]',
          '["chatId",true,false]',
          '[["chatId","position"],false,false]',
          '["tags",false,true]',
        ].sort(),
      );

      const chat = store.index('["chatId",false,false]');
      const uniqueChat = store.index('["chatId",true,false]');
      const position = store.index('[["chatId","position"],false,false]');
      const tags = store.index('["tags",false,true]');

      expect(chat.keyPath).toBe('chatId');
      expect(chat.unique).toBe(false);
      expect(chat.multiEntry).toBe(false);
      expect(uniqueChat.keyPath).toBe('chatId');
      expect(uniqueChat.unique).toBe(true);
      expect(uniqueChat.multiEntry).toBe(false);
      expect(position.keyPath).toEqual(['chatId', 'position']);
      expect(position.unique).toBe(false);
      expect(position.multiEntry).toBe(false);
      expect(tags.keyPath).toBe('tags');
      expect(tags.unique).toBe(false);
      expect(tags.multiEntry).toBe(true);
    } finally {
      database.close();
    }
  });

  it('не изменяет immutable compiled schema', async () => {
    const before = JSON.stringify(compiledSchema);
    const database = await openWithSchema(new IDBFactory(), compiledSchema);

    database.close();

    expect(JSON.stringify(compiledSchema)).toBe(before);
    expect(Object.isFrozen(compiledSchema.stores[0]?.indexes[2]?.keyPath)).toBe(true);
  });
});
