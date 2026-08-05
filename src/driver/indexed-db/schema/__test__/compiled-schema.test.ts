import { createCompiledSchema } from '../index.ts';
import type { CompiledIndex, CompiledSchema, CompiledStore } from '../index.ts';

describe('CompiledSchema', () => {
  it('создаёт immutable physical schema value', () => {
    const compiled = createCompiledSchema({
      name: 'ai-analytics-assistant',
      version: 1,
      stores: [
        {
          name: 'messages',
          keyPath: 'id',
          autoIncrement: false,
          indexes: [
            {
              name: 'physical-index',
              keyPath: ['chatId', 'position'],
              unique: true,
              multiEntry: false,
            },
          ],
        },
      ],
    });

    expectTypeOf(compiled).toEqualTypeOf<CompiledSchema>();
    expect(compiled).toEqual({
      name: 'ai-analytics-assistant',
      version: 1,
      stores: [
        {
          name: 'messages',
          keyPath: 'id',
          autoIncrement: false,
          indexes: [
            {
              name: 'physical-index',
              keyPath: ['chatId', 'position'],
              unique: true,
              multiEntry: false,
            },
          ],
        },
      ],
    });
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.stores)).toBe(true);
    expect(Object.isFrozen(compiled.stores[0])).toBe(true);
    expect(Object.isFrozen(compiled.stores[0]?.indexes)).toBe(true);
    expect(Object.isFrozen(compiled.stores[0]?.indexes[0])).toBe(true);
    expect(Object.isFrozen(compiled.stores[0]?.indexes[0]?.keyPath)).toBe(true);
  });

  it('не разделяет mutable arrays с входным значением', () => {
    const storeKeyPath = ['tenantId', 'id'];
    const indexKeyPath = ['chatId', 'position'];
    const indexes: CompiledIndex[] = [
      {
        name: 'physical-index',
        keyPath: indexKeyPath,
        unique: false,
        multiEntry: false,
      },
    ];
    const stores: CompiledStore[] = [
      {
        name: 'messages',
        keyPath: storeKeyPath,
        autoIncrement: false,
        indexes,
      },
    ];

    const compiled = createCompiledSchema({
      name: 'ai-analytics-assistant',
      version: 1,
      stores,
    });

    storeKeyPath.push('revision');
    indexKeyPath.push('id');
    indexes.push({
      name: 'another-physical-index',
      keyPath: 'id',
      unique: true,
      multiEntry: false,
    });
    stores.push({
      name: 'chats',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [],
    });

    expect(compiled.stores).toHaveLength(1);
    expect(compiled.stores[0]?.keyPath).toEqual(['tenantId', 'id']);
    expect(compiled.stores[0]?.indexes).toHaveLength(1);
    expect(compiled.stores[0]?.indexes[0]?.keyPath).toEqual(['chatId', 'position']);
    expect(compiled.stores).not.toBe(stores);
    expect(compiled.stores[0]?.keyPath).not.toBe(storeKeyPath);
    expect(compiled.stores[0]?.indexes).not.toBe(indexes);
    expect(compiled.stores[0]?.indexes[0]?.keyPath).not.toBe(indexKeyPath);
  });

  it('сохраняет external primary key как null key path', () => {
    const compiled = createCompiledSchema({
      name: 'external-keys',
      version: 1,
      stores: [
        {
          name: 'records',
          keyPath: null,
          autoIncrement: true,
          indexes: [],
        },
      ],
    });

    expect(compiled.stores[0]).toMatchObject({
      keyPath: null,
      autoIncrement: true,
    });
  });
});
