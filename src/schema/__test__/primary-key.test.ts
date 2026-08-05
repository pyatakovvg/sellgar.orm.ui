import {
  createAssignedRecordPrimaryKey,
  createAutoIncrementRecordPrimaryKey,
  createCompoundKeyPath,
  createKeyPath,
  ExternalPrimaryKey,
  externalKey,
  RecordPrimaryKey,
} from '../index.ts';
import type { PrimaryKey, PrimaryKeyValue } from '../index.ts';

interface MessageRecord {
  readonly id: string;
  readonly sequence: number;
  readonly chatId: string;
  readonly position: number;
  readonly optionalId?: string;
  readonly nullableId: string | null;
  readonly optionalSequence?: number;
}

describe('PrimaryKey', () => {
  it('выводит assigned record key из simple и compound KeyPath', () => {
    const simplePath = createKeyPath<MessageRecord>()('messages', 'id');
    const compoundPath = createCompoundKeyPath<MessageRecord>()('messages', ['chatId', 'position']);
    const simple = createAssignedRecordPrimaryKey(simplePath);
    const compound = createAssignedRecordPrimaryKey(compoundPath);

    expectTypeOf(simple).toEqualTypeOf<RecordPrimaryKey<string, 'assigned', typeof simplePath>>();
    expectTypeOf<PrimaryKeyValue<typeof simple>>().toEqualTypeOf<string>();
    expectTypeOf<PrimaryKeyValue<typeof compound>>().toEqualTypeOf<readonly [string, number]>();
    expectTypeOf<typeof simple>().toMatchTypeOf<PrimaryKey>();
    expectTypeOf<typeof compound>().toMatchTypeOf<PrimaryKey>();
    expect(compound.keyPath.fields.map(({ path }) => path)).toEqual(['chatId', 'position']);
  });

  it('создаёт auto-increment только для non-nullable numeric simple path', () => {
    const keyPath = createKeyPath<MessageRecord>()('messages', 'sequence');
    const primaryKey = createAutoIncrementRecordPrimaryKey(keyPath);

    expectTypeOf(primaryKey).toEqualTypeOf<RecordPrimaryKey<number, 'autoIncrement', typeof keyPath>>();
    expectTypeOf<PrimaryKeyValue<typeof primaryKey>>().toEqualTypeOf<number>();
  });

  it('создаёт assigned и auto-increment external keys без runtime type metadata', () => {
    const stringKey = externalKey<string>();
    const compoundKey = externalKey<readonly [string, number]>();
    const autoIncrementKey = externalKey({
      generation: 'autoIncrement',
    });

    expectTypeOf(stringKey).toEqualTypeOf<ExternalPrimaryKey<string, 'assigned'>>();
    expectTypeOf(compoundKey).toEqualTypeOf<ExternalPrimaryKey<readonly [string, number], 'assigned'>>();
    expectTypeOf(autoIncrementKey).toEqualTypeOf<ExternalPrimaryKey<number, 'autoIncrement'>>();
    expectTypeOf<PrimaryKeyValue<typeof stringKey>>().toEqualTypeOf<string>();
    expectTypeOf<PrimaryKeyValue<typeof compoundKey>>().toEqualTypeOf<readonly [string, number]>();
    expectTypeOf<PrimaryKeyValue<typeof autoIncrementKey>>().toEqualTypeOf<number>();
  });

  it('создаёт immutable record primary key с явной location и policy', () => {
    const keyPath = createKeyPath<MessageRecord>()('messages', 'id');
    const primaryKey = createAssignedRecordPrimaryKey(keyPath);

    expect(primaryKey).toBeInstanceOf(RecordPrimaryKey);
    expect(primaryKey).toMatchObject({
      kind: 'record-primary-key',
      source: 'record',
      generation: 'assigned',
      keyPath,
    });
    expect(Object.isFrozen(primaryKey)).toBe(true);
    expect(Reflect.set(primaryKey, 'generation', 'autoIncrement')).toBe(false);
  });

  it('создаёт immutable external primary keys', () => {
    const assigned = externalKey<string>();
    const autoIncrement = externalKey({
      generation: 'autoIncrement',
    });

    expect(assigned).toBeInstanceOf(ExternalPrimaryKey);
    expect(assigned).toEqual({
      kind: 'external-primary-key',
      source: 'external',
      generation: 'assigned',
    });
    expect(autoIncrement).toEqual({
      kind: 'external-primary-key',
      source: 'external',
      generation: 'autoIncrement',
    });
    expect(Object.isFrozen(assigned)).toBe(true);
    expect(Object.isFrozen(autoIncrement)).toBe(true);
    expect('keyType' in assigned).toBe(false);
  });

  it('отклоняет nullable record keys и несовместимый auto-increment compile-time', () => {
    const keyPath = createKeyPath<MessageRecord>();
    const compoundPath = createCompoundKeyPath<MessageRecord>();
    const optionalId = keyPath('messages', 'optionalId');
    const nullableId = keyPath('messages', 'nullableId');
    const optionalSequence = keyPath('messages', 'optionalSequence');
    const stringId = keyPath('messages', 'id');
    const compound = compoundPath('messages', ['chatId', 'position']);
    const nullableCompound = compoundPath('messages', ['chatId', 'optionalSequence']);

    if (false) {
      // @ts-expect-error record primary key должен присутствовать в persisted record.
      createAssignedRecordPrimaryKey(optionalId);
      // @ts-expect-error null не является допустимым persisted primary key.
      createAssignedRecordPrimaryKey(nullableId);
      // @ts-expect-error каждый compound component должен быть non-nullable.
      createAssignedRecordPrimaryKey(nullableCompound);
      // @ts-expect-error auto-increment требует number key.
      createAutoIncrementRecordPrimaryKey(stringId);
      // @ts-expect-error auto-increment не поддерживает compound key path.
      createAutoIncrementRecordPrimaryKey(compound);
      // @ts-expect-error generated record key должен быть non-nullable.
      createAutoIncrementRecordPrimaryKey(optionalSequence);
    }

    expect([optionalId, nullableId, optionalSequence, stringId, compound]).toHaveLength(5);
  });

  it('требует явный допустимый type для assigned external key', () => {
    if (false) {
      // @ts-expect-error assigned external key type невозможно вывести без generic.
      externalKey();
      // @ts-expect-error boolean не является browser storage key.
      externalKey<boolean>();
      // @ts-expect-error never не является осмысленным external key type.
      externalKey<never>();
      // @ts-expect-error assigned является default и не задаётся runtime option.
      externalKey({ generation: 'assigned' });
    }

    expect(true).toBe(true);
  });
});
