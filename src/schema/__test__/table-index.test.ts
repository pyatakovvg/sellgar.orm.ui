import { createIndex, Index } from '../index.ts';
import type { IndexValue, TableIndex } from '../index.ts';

interface MessageRecord {
  readonly chatId: string;
  readonly position: number;
  readonly externalId: string;
  readonly tags: readonly string[];
  readonly optionalTags?: readonly string[];
  readonly delivered: boolean;
  readonly metadata: {
    readonly source: string;
  };
}

describe('Index', () => {
  it('выводит key types simple, compound и обычного array index', () => {
    const index = createIndex<MessageRecord>();
    const simple = index('messages', {
      keyPath: 'chatId',
    });
    const compound = index('messages', {
      keyPath: ['chatId', 'position'],
    });
    const array = index('messages', {
      keyPath: 'tags',
    });

    expectTypeOf<IndexValue<typeof simple>>().toEqualTypeOf<string>();
    expectTypeOf<IndexValue<typeof compound>>().toEqualTypeOf<readonly [string, number]>();
    expectTypeOf<IndexValue<typeof array>>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<typeof simple>().toMatchTypeOf<TableIndex>();
    expect([simple.keyPath.kind, compound.keyPath.kind, array.keyPath.kind]).toEqual([
      'simple-key-path',
      'compound-key-path',
      'simple-key-path',
    ]);
  });

  it('выводит element key type для multi-entry index', () => {
    const index = createIndex<MessageRecord>();
    const tags = index('messages', {
      keyPath: 'tags',
      multiEntry: true,
    });
    const optionalTags = index('messages', {
      keyPath: 'optionalTags',
      unique: true,
      multiEntry: true,
    });

    expectTypeOf(tags).toEqualTypeOf<Index<string, typeof tags.keyPath, false, true>>();
    expectTypeOf(optionalTags).toEqualTypeOf<Index<string, typeof optionalTags.keyPath, true, true>>();
    expectTypeOf<IndexValue<typeof tags>>().toEqualTypeOf<string>();
    expectTypeOf<IndexValue<typeof optionalTags>>().toEqualTypeOf<string>();
  });

  it('создаёт immutable index с нормализованными options', () => {
    const index = createIndex<MessageRecord>()('messages', {
      keyPath: ['chatId', 'position'],
      unique: true,
    });

    expect(index).toBeInstanceOf(Index);
    expect(index).toMatchObject({
      kind: 'index',
      unique: true,
      multiEntry: false,
    });
    expect(index.keyPath.kind).toBe('compound-key-path');
    expect(Object.isFrozen(index.keyPath)).toBe(true);
    expect(Object.isFrozen(index)).toBe(true);
    expect(Reflect.set(index, 'unique', false)).toBe(false);
    expect('name' in index).toBe(false);
  });

  it('отклоняет invalid paths и несовместимый multi-entry compile-time', () => {
    const index = createIndex<MessageRecord>();
    const dynamicMultiEntry: boolean = true;

    if (false) {
      // @ts-expect-error boolean field не является storage key.
      index('messages', { keyPath: 'delivered' });
      // @ts-expect-error произвольный object не является storage key.
      index('messages', { keyPath: 'metadata' });
      // @ts-expect-error multi-entry требует array field.
      index('messages', { keyPath: 'chatId', multiEntry: true });
      // @ts-expect-error compound multi-entry запрещён.
      index('messages', {
        keyPath: ['chatId', 'position'],
        multiEntry: true,
      });
      // @ts-expect-error multi-entry должен быть schema literal.
      index('messages', {
        keyPath: 'tags',
        multiEntry: dynamicMultiEntry,
      });
    }

    expect(dynamicMultiEntry).toBe(true);
  });
});
