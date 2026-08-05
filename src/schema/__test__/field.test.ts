import { createField, Field } from '../field.ts';
import type { FieldPath, FieldValue } from '../field.ts';

interface MessageRecord {
  readonly id: string;
  readonly author: {
    readonly id: string;
    readonly profile?: {
      readonly rank: number;
    };
  };
  readonly optionalAuthor?: {
    readonly id: string;
  };
  readonly nullableAuthor: {
    readonly id: string;
  } | null;
  readonly tags: readonly string[];
  readonly title: string;
  readonly createdAt: Date;
  readonly payload: ArrayBuffer;
  readonly attachment: File;
  readonly metadata: ReadonlyMap<string, string>;
}

describe('Field', () => {
  it('проверяет simple, nested и storage-native paths compile-time', () => {
    expectTypeOf<FieldPath<MessageRecord, 'id'>>().toEqualTypeOf<'id'>();
    expectTypeOf<FieldPath<MessageRecord, 'author.id'>>().toEqualTypeOf<'author.id'>();
    expectTypeOf<FieldPath<MessageRecord, 'author.profile.rank'>>().toEqualTypeOf<'author.profile.rank'>();
    expectTypeOf<FieldPath<MessageRecord, 'title.length'>>().toEqualTypeOf<'title.length'>();
    expectTypeOf<FieldPath<MessageRecord, 'tags.length'>>().toEqualTypeOf<'tags.length'>();
    expectTypeOf<FieldPath<MessageRecord, 'attachment.name'>>().toEqualTypeOf<'attachment.name'>();

    expectTypeOf<FieldPath<MessageRecord, ''>>().toEqualTypeOf<never>();
    expectTypeOf<FieldPath<MessageRecord, 'unknown'>>().toEqualTypeOf<never>();
    expectTypeOf<FieldPath<MessageRecord, 'author.unknown'>>().toEqualTypeOf<never>();
    expectTypeOf<FieldPath<MessageRecord, 'createdAt.getTime'>>().toEqualTypeOf<never>();
    expectTypeOf<FieldPath<MessageRecord, 'payload.byteLength'>>().toEqualTypeOf<never>();
    expectTypeOf<FieldPath<MessageRecord, 'metadata.size'>>().toEqualTypeOf<never>();
  });

  it('выводит значение и отсутствие optional intermediate path', () => {
    expectTypeOf<FieldValue<MessageRecord, 'id'>>().toEqualTypeOf<string>();
    expectTypeOf<FieldValue<MessageRecord, 'author.profile.rank'>>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FieldValue<MessageRecord, 'optionalAuthor.id'>>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FieldValue<MessageRecord, 'nullableAuthor.id'>>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FieldValue<MessageRecord, 'tags'>>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<FieldValue<MessageRecord, 'title.length'>>().toEqualTypeOf<number>();
  });

  it('создаёт immutable table-bound runtime value', () => {
    const field = createField<MessageRecord>()('messages', 'author.id');

    expectTypeOf(field).toEqualTypeOf<Field<'messages', MessageRecord, 'author.id', string>>();
    expect(field).toBeInstanceOf(Field);
    expect(field).toMatchObject({
      kind: 'field',
      tableName: 'messages',
      path: 'author.id',
    });
    expect(Object.isFrozen(field)).toBe(true);
    expect(Reflect.set(field, 'path', 'id')).toBe(false);
  });

  it('отклоняет неизвестный или dynamic path compile-time', () => {
    const field = createField<MessageRecord>();
    const dynamicPath: string = 'author.id';

    const assertTypeErrors = (): void => {
      // @ts-expect-error field отсутствует в MessageRecord.
      field('messages', 'unknown');
      // @ts-expect-error nested field отсутствует в MessageRecord.
      field('messages', 'author.unknown');
      // @ts-expect-error dynamic string не доказывает корректность field path.
      field('messages', dynamicPath);
    };
    void assertTypeErrors;

    expect(dynamicPath).toBe('author.id');
  });
});
