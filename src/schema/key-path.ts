import { createFieldValue, Field } from './field.ts';
import type { FieldPath, FieldValue } from './field.ts';
import type { StorageKey } from '../key';

type IsAny<Value> = 0 extends 1 & Value ? true : false;

type KeyValue<Value> =
  IsAny<Value> extends true
    ? never
    : [NonNullable<Value>] extends [never]
      ? never
      : [NonNullable<Value>] extends [StorageKey]
        ? NonNullable<Value>
        : never;

type KeyFieldPath<RecordType, Path extends string> =
  FieldPath<RecordType, Path> extends never
    ? never
    : KeyValue<FieldValue<RecordType, Path>> extends never
      ? never
      : Path;

export type KeyPathInput = string | readonly [string, string, ...string[]];

type CompoundPaths = Extract<KeyPathInput, readonly string[]>;
type CompoundStorageKey = readonly [StorageKey, StorageKey, ...StorageKey[]];

type KeyFields<TableName extends string, RecordType extends object, Paths extends CompoundPaths> = {
  readonly [Index in keyof Paths]: Paths[Index] extends string
    ? Field<TableName, RecordType, Paths[Index], unknown>
    : never;
};

type CompoundKeyValues<RecordType, Paths extends CompoundPaths> = Paths extends readonly [
  infer First extends string,
  infer Second extends string,
  ...infer Rest extends string[],
]
  ? readonly [
      KeyValue<FieldValue<RecordType, First>>,
      KeyValue<FieldValue<RecordType, Second>>,
      ...{
        readonly [Index in keyof Rest]: KeyValue<FieldValue<RecordType, Rest[Index]>>;
      },
    ]
  : never;

type CheckedCompoundPaths<RecordType, Paths extends CompoundPaths> = {
  readonly [Index in keyof Paths]: Paths[Index] extends string ? KeyFieldPath<RecordType, Paths[Index]> : never;
};

export type KeyPathFromInput<
  RecordType extends object,
  TableName extends string,
  Input extends KeyPathInput,
> = Input extends string
  ? SimpleKeyPath<KeyValue<FieldValue<RecordType, Input>>, TableName, RecordType, Input>
  : Input extends CompoundPaths
    ? CompoundKeyPath<CompoundKeyValues<RecordType, Input>, TableName, RecordType, Input>
    : never;

export type CheckedKeyPathInput<RecordType extends object, Input extends KeyPathInput> = Input extends string
  ? Input & KeyFieldPath<RecordType, Input>
  : Input extends CompoundPaths
    ? Input & CheckedCompoundPaths<RecordType, Input>
    : never;

const simpleKeyPathCreationToken = Symbol('simple-key-path-creation');
const compoundKeyPathCreationToken = Symbol('compound-key-path-creation');

export class SimpleKeyPath<
  Key extends StorageKey,
  TableName extends string,
  RecordType extends object,
  Path extends string,
> {
  public readonly kind = 'simple-key-path';

  declare private readonly keyType: Key;

  private constructor(public readonly field: Field<TableName, RecordType, Path, unknown>) {
    Object.freeze(this);
  }

  /** @internal */
  public static create<
    Key extends StorageKey,
    TableName extends string,
    RecordType extends object,
    Path extends string,
  >(
    token: typeof simpleKeyPathCreationToken,
    field: Field<TableName, RecordType, Path, unknown>,
  ): SimpleKeyPath<Key, TableName, RecordType, Path> {
    if (token !== simpleKeyPathCreationToken) {
      throw new TypeError('SimpleKeyPath can only be created from a table field');
    }

    return new SimpleKeyPath<Key, TableName, RecordType, Path>(field);
  }
}

export class CompoundKeyPath<
  Key extends readonly StorageKey[],
  TableName extends string,
  RecordType extends object,
  Paths extends CompoundPaths,
> {
  public readonly kind = 'compound-key-path';

  declare private readonly keyType: Key;

  private constructor(public readonly fields: KeyFields<TableName, RecordType, Paths>) {
    Object.freeze(this);
  }

  /** @internal */
  public static create<
    Key extends readonly StorageKey[],
    TableName extends string,
    RecordType extends object,
    Paths extends CompoundPaths,
  >(
    token: typeof compoundKeyPathCreationToken,
    fields: KeyFields<TableName, RecordType, Paths>,
  ): CompoundKeyPath<Key, TableName, RecordType, Paths> {
    if (token !== compoundKeyPathCreationToken) {
      throw new TypeError('CompoundKeyPath can only be created from table fields');
    }

    return new CompoundKeyPath<Key, TableName, RecordType, Paths>(fields);
  }
}

export type KeyPath =
  | SimpleKeyPath<StorageKey, string, object, string>
  | CompoundKeyPath<CompoundStorageKey, string, object, CompoundPaths>;

export type KeyPathValue<Path> =
  Path extends SimpleKeyPath<infer Key, string, object, string>
    ? Key
    : Path extends CompoundKeyPath<infer Key, string, object, CompoundPaths>
      ? Key
      : never;

const createSimpleKeyPathValue = <RecordType extends object, TableName extends string, Path extends string>(
  tableName: TableName,
  path: Path,
): SimpleKeyPath<KeyValue<FieldValue<RecordType, Path>>, TableName, RecordType, Path> => {
  const field = createFieldValue<TableName, RecordType, Path, FieldValue<RecordType, Path>>(tableName, path);

  return SimpleKeyPath.create<KeyValue<FieldValue<RecordType, Path>>, TableName, RecordType, Path>(
    simpleKeyPathCreationToken,
    field,
  );
};

const createCompoundKeyPathValue = <RecordType extends object, TableName extends string, Paths extends CompoundPaths>(
  tableName: TableName,
  paths: Paths,
): CompoundKeyPath<CompoundKeyValues<RecordType, Paths>, TableName, RecordType, Paths> => {
  const fields = Object.freeze(
    paths.map((path) =>
      createFieldValue<TableName, RecordType, typeof path, FieldValue<RecordType, typeof path>>(tableName, path),
    ),
  ) as KeyFields<TableName, RecordType, Paths>;

  return CompoundKeyPath.create<CompoundKeyValues<RecordType, Paths>, TableName, RecordType, Paths>(
    compoundKeyPathCreationToken,
    fields,
  );
};

/** @internal */
export const createKeyPath =
  <RecordType extends object>() =>
  <const TableName extends string, const Path extends string>(
    tableName: TableName,
    path: Path & KeyFieldPath<RecordType, Path>,
  ): SimpleKeyPath<KeyValue<FieldValue<RecordType, Path>>, TableName, RecordType, Path> =>
    createSimpleKeyPathValue<RecordType, TableName, Path>(tableName, path);

/** @internal */
export const createCompoundKeyPath =
  <RecordType extends object>() =>
  <const TableName extends string, const Paths extends CompoundPaths>(
    tableName: TableName,
    paths: Paths & CheckedCompoundPaths<RecordType, Paths>,
  ): CompoundKeyPath<CompoundKeyValues<RecordType, Paths>, TableName, RecordType, Paths> =>
    createCompoundKeyPathValue<RecordType, TableName, Paths>(tableName, paths);

/** @internal */
export const createKeyPathValue = <RecordType extends object, TableName extends string>(
  tableName: TableName,
  input: KeyPathInput,
): KeyPath => {
  if (typeof input === 'string') {
    return createSimpleKeyPathValue<RecordType, TableName, typeof input>(tableName, input);
  }

  return createCompoundKeyPathValue<RecordType, TableName, typeof input>(tableName, input);
};

/** @internal */
export const createKeyPathFromInput =
  <RecordType extends object>() =>
  <const TableName extends string, const Input extends KeyPathInput>(
    tableName: TableName,
    input: Input & CheckedKeyPathInput<RecordType, Input>,
  ): KeyPathFromInput<RecordType, TableName, Input> => {
    return createKeyPathValue<RecordType, TableName>(tableName, input) as unknown as KeyPathFromInput<
      RecordType,
      TableName,
      Input
    >;
  };
