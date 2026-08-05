import { createKeyPathValue, SimpleKeyPath } from './key-path.ts';
import type { CheckedKeyPathInput, KeyPath, KeyPathFromInput, KeyPathInput, KeyPathValue } from './key-path.ts';
import type { FieldValue } from './field.ts';
import type { StorageKey } from '../key/index.ts';

export interface IndexInput {
  readonly keyPath: KeyPathInput;
  readonly unique?: boolean;
  readonly multiEntry?: boolean;
}

type UniqueOption<Input extends IndexInput> = Input extends {
  readonly unique: infer Unique extends boolean;
}
  ? Unique
  : false;

type MultiEntryOption<Input extends IndexInput> = Input extends {
  readonly multiEntry: infer MultiEntry extends boolean;
}
  ? MultiEntry
  : false;

type MultiEntryKeyValue<Path extends KeyPath> =
  Path extends SimpleKeyPath<StorageKey, string, infer RecordType, infer FieldPath>
    ? NonNullable<FieldValue<RecordType, FieldPath>> extends readonly (infer Element)[]
      ? NonNullable<Element> extends StorageKey
        ? NonNullable<Element>
        : never
      : never
    : never;

type IndexKeyValue<Path extends KeyPath, MultiEntry extends boolean> = MultiEntry extends true
  ? MultiEntryKeyValue<Path>
  : Extract<KeyPathValue<Path>, StorageKey>;

const indexCreationToken = Symbol('index-creation');

export class Index<Key extends StorageKey, Path extends KeyPath, Unique extends boolean, MultiEntry extends boolean> {
  public readonly kind = 'index';

  declare private readonly keyType: Key;

  private constructor(
    public readonly keyPath: Path,
    public readonly unique: Unique,
    public readonly multiEntry: MultiEntry,
  ) {
    Object.freeze(this);
  }

  /** @internal */
  public static create<
    Key extends StorageKey,
    Path extends KeyPath,
    Unique extends boolean,
    MultiEntry extends boolean,
  >(
    token: typeof indexCreationToken,
    keyPath: Path,
    unique: Unique,
    multiEntry: MultiEntry,
  ): Index<Key, Path, Unique, MultiEntry> {
    if (token !== indexCreationToken) {
      throw new TypeError('Index can only be created by its table');
    }

    return new Index<Key, Path, Unique, MultiEntry>(keyPath, unique, multiEntry);
  }
}

export type TableIndex = Index<StorageKey, KeyPath, boolean, boolean>;

export type IndexValue<Type> = Type extends Index<infer Key, KeyPath, boolean, boolean> ? Key : never;

export type IndexFromInput<RecordType extends object, TableName extends string, Input extends IndexInput> =
  KeyPathFromInput<RecordType, TableName, Input['keyPath']> extends infer Path extends KeyPath
    ? MultiEntryOption<Input> extends true
      ? MultiEntryKeyValue<Path> extends never
        ? never
        : Index<MultiEntryKeyValue<Path>, Path, UniqueOption<Input>, true>
      : Index<IndexKeyValue<Path, false>, Path, UniqueOption<Input>, false>
    : never;

type CheckedMultiEntry<RecordType extends object, Input extends IndexInput> =
  boolean extends MultiEntryOption<Input>
    ? never
    : MultiEntryOption<Input> extends true
      ? IndexFromInput<RecordType, string, Input> extends never
        ? never
        : Input
      : Input;

export type CheckedIndexInput<
  RecordType extends object,
  Input extends IndexInput,
> = Input['keyPath'] extends infer Path extends KeyPathInput
  ? Path extends CheckedKeyPathInput<RecordType, Path>
    ? CheckedMultiEntry<RecordType, Input>
    : never
  : never;

/** @internal */
export const createIndexValue = <RecordType extends object, TableName extends string>(
  tableName: TableName,
  input: IndexInput,
): TableIndex => {
  const keyPath = createKeyPathValue<RecordType, TableName>(tableName, input.keyPath);
  const unique = input.unique ?? false;
  const multiEntry = input.multiEntry ?? false;

  return Index.create<StorageKey, KeyPath, boolean, boolean>(indexCreationToken, keyPath, unique, multiEntry);
};

/** @internal */
export const createIndex =
  <RecordType extends object>() =>
  <const TableName extends string, const Input extends IndexInput>(
    tableName: TableName,
    input: Input & CheckedIndexInput<RecordType, Input>,
  ): IndexFromInput<RecordType, TableName, Input> =>
    createIndexValue<RecordType, TableName>(tableName, input) as unknown as IndexFromInput<
      RecordType,
      TableName,
      Input
    >;
