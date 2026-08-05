import { CompoundKeyPath, createKeyPathValue, SimpleKeyPath } from './key-path.ts';
import type { KeyPath, KeyPathFromInput, KeyPathInput, KeyPathValue } from './key-path.ts';
import type { FieldValue } from './field.ts';
import type { StorageKey } from '../key';

type PrimaryKeyGeneration = 'assigned' | 'autoIncrement';
type CompoundPaths = readonly [string, string, ...string[]];

type NullableCompoundComponent<RecordType, Paths extends CompoundPaths> = {
  readonly [Index in keyof Paths]: Paths[Index] extends string
    ? Extract<FieldValue<RecordType, Paths[Index]>, null | undefined> extends never
      ? never
      : Paths[Index]
    : never;
}[number];

type NonNullableKeyPath<Path extends KeyPath> =
  Path extends SimpleKeyPath<StorageKey, string, infer RecordType, infer FieldPath>
    ? Extract<FieldValue<RecordType, FieldPath>, null | undefined> extends never
      ? Path
      : never
    : Path extends CompoundKeyPath<
          readonly [StorageKey, StorageKey, ...StorageKey[]],
          string,
          infer RecordType,
          infer Paths
        >
      ? NullableCompoundComponent<RecordType, Paths> extends never
        ? Path
        : never
      : never;

type AutoIncrementKeyPath<Path extends KeyPath> =
  Path extends SimpleKeyPath<infer Key, string, infer RecordType, infer FieldPath>
    ? [Key] extends [number]
      ? [number] extends [Key]
        ? Extract<FieldValue<RecordType, FieldPath>, null | undefined> extends never
          ? Path
          : never
        : never
      : never
    : never;

type ExplicitExternalKeyArguments<Key extends StorageKey> = [Key] extends [never]
  ? [keyTypeMustBeSpecified: never]
  : [StorageKey] extends [Key]
    ? [keyTypeMustBeSpecified: never]
    : [];

export type RecordPrimaryKeyInput =
  | KeyPathInput
  | {
      readonly source: 'record';
      readonly keyPath: KeyPathInput;
      readonly generation?: PrimaryKeyGeneration;
    };

export type PrimaryKeyInput = RecordPrimaryKeyInput | ExternalPrimaryKey<StorageKey, PrimaryKeyGeneration>;

const recordPrimaryKeyCreationToken = Symbol('record-primary-key-creation');
const externalPrimaryKeyCreationToken = Symbol('external-primary-key-creation');

export class RecordPrimaryKey<Key extends StorageKey, Generation extends PrimaryKeyGeneration, Path extends KeyPath> {
  public readonly kind = 'record-primary-key';
  public readonly source = 'record';

  declare private readonly keyType: Key;

  private constructor(
    public readonly keyPath: Path,
    public readonly generation: Generation,
  ) {
    Object.freeze(this);
  }

  /** @internal */
  public static create<Key extends StorageKey, Generation extends PrimaryKeyGeneration, Path extends KeyPath>(
    token: typeof recordPrimaryKeyCreationToken,
    keyPath: Path,
    generation: Generation,
  ): RecordPrimaryKey<Key, Generation, Path> {
    if (token !== recordPrimaryKeyCreationToken) {
      throw new TypeError('RecordPrimaryKey can only be created from a table key path');
    }

    return new RecordPrimaryKey<Key, Generation, Path>(keyPath, generation);
  }
}

export class ExternalPrimaryKey<Key extends StorageKey, Generation extends PrimaryKeyGeneration> {
  public readonly kind = 'external-primary-key';
  public readonly source = 'external';

  declare private readonly keyType: Key;

  private constructor(public readonly generation: Generation) {
    Object.freeze(this);
  }

  /** @internal */
  public static create<Key extends StorageKey, Generation extends PrimaryKeyGeneration>(
    token: typeof externalPrimaryKeyCreationToken,
    generation: Generation,
  ): ExternalPrimaryKey<Key, Generation> {
    if (token !== externalPrimaryKeyCreationToken) {
      throw new TypeError('ExternalPrimaryKey can only be created by externalKey');
    }

    return new ExternalPrimaryKey<Key, Generation>(generation);
  }
}

export type PrimaryKey =
  RecordPrimaryKey<StorageKey, PrimaryKeyGeneration, KeyPath> | ExternalPrimaryKey<StorageKey, PrimaryKeyGeneration>;

export type PrimaryKeyValue<Primary> =
  Primary extends RecordPrimaryKey<infer Key, PrimaryKeyGeneration, KeyPath>
    ? Key
    : Primary extends ExternalPrimaryKey<infer Key, PrimaryKeyGeneration>
      ? Key
      : never;

type AssignedRecordPrimaryKeyFromPath<Path extends KeyPath> =
  NonNullableKeyPath<Path> extends never
    ? never
    : RecordPrimaryKey<Extract<KeyPathValue<Path>, StorageKey>, 'assigned', Path>;

type AutoIncrementRecordPrimaryKeyFromPath<Path extends KeyPath> =
  AutoIncrementKeyPath<Path> extends never ? never : RecordPrimaryKey<number, 'autoIncrement', Path>;

export type PrimaryKeyFromInput<RecordType extends object, TableName extends string, Input extends PrimaryKeyInput> =
  Input extends ExternalPrimaryKey<StorageKey, PrimaryKeyGeneration>
    ? Input
    : Input extends {
          readonly source: 'record';
          readonly keyPath: infer Path extends KeyPathInput;
          readonly generation: 'autoIncrement';
        }
      ? AutoIncrementRecordPrimaryKeyFromPath<KeyPathFromInput<RecordType, TableName, Path>>
      : Input extends {
            readonly source: 'record';
            readonly keyPath: infer Path extends KeyPathInput;
            readonly generation?: 'assigned';
          }
        ? AssignedRecordPrimaryKeyFromPath<KeyPathFromInput<RecordType, TableName, Path>>
        : Input extends KeyPathInput
          ? AssignedRecordPrimaryKeyFromPath<KeyPathFromInput<RecordType, TableName, Input>>
          : never;

export type CheckedPrimaryKeyInput<RecordType extends object, TableName extends string, Input extends PrimaryKeyInput> =
  PrimaryKeyFromInput<RecordType, TableName, Input> extends never ? never : Input;

const createAssignedRecordPrimaryKeyValue = <Path extends KeyPath>(
  keyPath: Path,
): RecordPrimaryKey<Extract<KeyPathValue<Path>, StorageKey>, 'assigned', Path> =>
  RecordPrimaryKey.create<Extract<KeyPathValue<Path>, StorageKey>, 'assigned', Path>(
    recordPrimaryKeyCreationToken,
    keyPath,
    'assigned',
  );

const createAutoIncrementRecordPrimaryKeyValue = <Path extends KeyPath>(
  keyPath: Path,
): RecordPrimaryKey<number, 'autoIncrement', Path> =>
  RecordPrimaryKey.create<number, 'autoIncrement', Path>(recordPrimaryKeyCreationToken, keyPath, 'autoIncrement');

/** @internal */
export const createAssignedRecordPrimaryKey = <const Path extends KeyPath>(
  keyPath: Path & NonNullableKeyPath<Path>,
): RecordPrimaryKey<Extract<KeyPathValue<Path>, StorageKey>, 'assigned', Path> =>
  createAssignedRecordPrimaryKeyValue(keyPath);

/** @internal */
export const createAutoIncrementRecordPrimaryKey = <const Path extends KeyPath>(
  keyPath: Path & AutoIncrementKeyPath<Path>,
): RecordPrimaryKey<number, 'autoIncrement', Path> => createAutoIncrementRecordPrimaryKeyValue(keyPath);

export function externalKey<Key extends StorageKey>(
  ...arguments_: ExplicitExternalKeyArguments<Key>
): ExternalPrimaryKey<Key, 'assigned'>;
export function externalKey(options: {
  readonly generation: 'autoIncrement';
}): ExternalPrimaryKey<number, 'autoIncrement'>;
export function externalKey(options?: {
  readonly generation: 'autoIncrement';
}): ExternalPrimaryKey<StorageKey, PrimaryKeyGeneration> {
  if (options?.generation === 'autoIncrement') {
    return ExternalPrimaryKey.create<number, 'autoIncrement'>(externalPrimaryKeyCreationToken, 'autoIncrement');
  }

  return ExternalPrimaryKey.create<StorageKey, 'assigned'>(externalPrimaryKeyCreationToken, 'assigned');
}

/** @internal */
export const createPrimaryKeyValue = <RecordType extends object, TableName extends string>(
  tableName: TableName,
  input: PrimaryKeyInput,
): PrimaryKey => {
  if (input instanceof ExternalPrimaryKey) {
    return input;
  }

  let keyPathInput: KeyPathInput;
  let generation: PrimaryKeyGeneration;

  if (typeof input === 'string' || Array.isArray(input)) {
    keyPathInput = input as KeyPathInput;
    generation = 'assigned';
  } else {
    const descriptor = input as Exclude<RecordPrimaryKeyInput, KeyPathInput>;
    keyPathInput = descriptor.keyPath;
    generation = descriptor.generation ?? 'assigned';
  }

  const keyPath = createKeyPathValue<RecordType, TableName>(tableName, keyPathInput);

  if (generation === 'autoIncrement') {
    return createAutoIncrementRecordPrimaryKeyValue(keyPath);
  }

  return createAssignedRecordPrimaryKeyValue(keyPath);
};

/** @internal */
export const createPrimaryKey =
  <RecordType extends object>() =>
  <const TableName extends string, const Input extends PrimaryKeyInput>(
    tableName: TableName,
    input: Input & CheckedPrimaryKeyInput<RecordType, TableName, Input>,
  ): PrimaryKeyFromInput<RecordType, TableName, Input> => {
    return createPrimaryKeyValue<RecordType, TableName>(tableName, input) as unknown as PrimaryKeyFromInput<
      RecordType,
      TableName,
      Input
    >;
  };
