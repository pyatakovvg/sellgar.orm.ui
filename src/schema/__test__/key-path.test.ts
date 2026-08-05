import { CompoundKeyPath, createCompoundKeyPath, createKeyPath, SimpleKeyPath } from '../index.ts';
import type { KeyPath, KeyPathValue } from '../index.ts';

interface MessageRecord {
  readonly id: string;
  readonly author: {
    readonly id: string;
  };
  readonly chatId: string;
  readonly position: number;
  readonly optionalPosition?: number;
  readonly nullablePosition: number | null;
  readonly tags: readonly string[];
  readonly tuple: readonly [string, number];
  readonly delivered: boolean;
  readonly metadata: {
    readonly source: string;
  };
  readonly unknownValue: unknown;
}

describe('KeyPath', () => {
  it('выводит simple key type из simple и nested fields', () => {
    const keyPath = createKeyPath<MessageRecord>();
    const id = keyPath('messages', 'id');
    const authorId = keyPath('messages', 'author.id');
    const optionalPosition = keyPath('messages', 'optionalPosition');
    const nullablePosition = keyPath('messages', 'nullablePosition');
    const tags = keyPath('messages', 'tags');
    const tuple = keyPath('messages', 'tuple');

    expectTypeOf(id).toEqualTypeOf<SimpleKeyPath<string, 'messages', MessageRecord, 'id'>>();
    expectTypeOf(authorId).toEqualTypeOf<SimpleKeyPath<string, 'messages', MessageRecord, 'author.id'>>();
    expectTypeOf<KeyPathValue<typeof optionalPosition>>().toEqualTypeOf<number>();
    expectTypeOf<KeyPathValue<typeof nullablePosition>>().toEqualTypeOf<number>();
    expectTypeOf<KeyPathValue<typeof tags>>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<KeyPathValue<typeof tuple>>().toEqualTypeOf<readonly [string, number]>();
    expectTypeOf<typeof id>().toMatchTypeOf<KeyPath>();
    expect([optionalPosition, nullablePosition, tags, tuple].map(({ field }) => field.path)).toEqual([
      'optionalPosition',
      'nullablePosition',
      'tags',
      'tuple',
    ]);
  });

  it('выводит ordered tuple compound key без consumer casts', () => {
    const keyPath = createCompoundKeyPath<MessageRecord>()('messages', ['chatId', 'position']);

    expectTypeOf(keyPath).toEqualTypeOf<
      CompoundKeyPath<readonly [string, number], 'messages', MessageRecord, readonly ['chatId', 'position']>
    >();
    expectTypeOf<KeyPathValue<typeof keyPath>>().toEqualTypeOf<readonly [string, number]>();
  });

  it('создаёт immutable simple runtime value', () => {
    const keyPath = createKeyPath<MessageRecord>()('messages', 'author.id');

    expect(keyPath).toBeInstanceOf(SimpleKeyPath);
    expect(keyPath).toMatchObject({
      kind: 'simple-key-path',
      field: {
        kind: 'field',
        tableName: 'messages',
        path: 'author.id',
      },
    });
    expect(Object.isFrozen(keyPath)).toBe(true);
    expect(Object.isFrozen(keyPath.field)).toBe(true);
    expect(Reflect.set(keyPath, 'field', undefined)).toBe(false);
  });

  it('сохраняет порядок и неизменяемость compound fields', () => {
    const keyPath = createCompoundKeyPath<MessageRecord>()('messages', ['chatId', 'position']);

    expect(keyPath).toBeInstanceOf(CompoundKeyPath);
    expect(keyPath.kind).toBe('compound-key-path');
    expect(keyPath.fields.map((field) => field.path)).toEqual(['chatId', 'position']);
    expect(keyPath.fields.every((field) => field.tableName === 'messages')).toBe(true);
    expect(keyPath.fields.every((field) => Object.isFrozen(field))).toBe(true);
    expect(Object.isFrozen(keyPath.fields)).toBe(true);
    expect(Object.isFrozen(keyPath)).toBe(true);
    expect(Reflect.set(keyPath.fields, '0', keyPath.fields[1])).toBe(false);
  });

  it('отклоняет non-key fields и некорректные compound paths compile-time', () => {
    const simple = createKeyPath<MessageRecord>();
    const compound = createCompoundKeyPath<MessageRecord>();
    const dynamicPath: string = 'id';
    const dynamicPaths: string[] = ['chatId', 'position'];

    if (false) {
      // @ts-expect-error boolean не входит в StorageKey.
      simple('messages', 'delivered');
      // @ts-expect-error произвольный object не входит в StorageKey.
      simple('messages', 'metadata');
      // @ts-expect-error unknown не доказывает совместимость со StorageKey.
      simple('messages', 'unknownValue');
      // @ts-expect-error empty field path запрещён.
      simple('messages', '');
      // @ts-expect-error dynamic string не доказывает корректность key field.
      simple('messages', dynamicPath);
      // @ts-expect-error compound path должен содержать минимум два поля.
      compound('messages', ['id']);
      // @ts-expect-error empty compound path запрещён.
      compound('messages', []);
      // @ts-expect-error nested tuples запрещены.
      compound('messages', [['chatId', 'position'], 'id']);
      // @ts-expect-error каждый compound component должен быть key-compatible.
      compound('messages', ['chatId', 'delivered']);
      // @ts-expect-error dynamic array не доказывает tuple shape и field paths.
      compound('messages', dynamicPaths);
    }

    expect([dynamicPath, dynamicPaths]).toHaveLength(2);
  });
});
