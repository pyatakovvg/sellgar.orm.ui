import { createFieldValue, Field } from './field.ts';
import type { FieldPath, FieldValue } from './field.ts';
import { createPrimaryKeyValue } from './primary-key.ts';
import type {
  CheckedPrimaryKeyInput,
  PrimaryKey,
  PrimaryKeyFromInput,
  PrimaryKeyInput,
  PrimaryKeyValue,
} from './primary-key.ts';
import { createIndexValue } from './table-index.ts';
import type { CheckedIndexInput, IndexFromInput, IndexInput, TableIndex } from './table-index.ts';
import { validateTableDefinition } from './schema-validator.ts';

type IndexInputs = readonly IndexInput[];
type RecordArguments<RecordType extends object> = RecordType extends readonly unknown[]
  ? [arrayRecordIsNotSupported: never]
  : [];
type EntityConstructor<EntityType extends object> = new () => EntityType;
type EntityRecord<EntityType extends object> = {
  [Key in keyof EntityType as EntityType[Key] extends (...arguments_: never[]) => unknown ? never : Key]: EntityType[Key];
};

export interface TableDefinitionInput {
  readonly primaryKey: PrimaryKeyInput;
  readonly indexes: IndexInputs;
}

type TableIndexesFromInput<RecordType extends object, TableName extends string, Inputs extends IndexInputs> = {
  readonly [Index in keyof Inputs]: Inputs[Index] extends IndexInput
    ? IndexFromInput<RecordType, TableName, Inputs[Index]>
    : never;
};

type CheckedIndexInputs<RecordType extends object, Inputs extends IndexInputs> = {
  readonly [Index in keyof Inputs]: Inputs[Index] extends IndexInput
    ? Inputs[Index] & CheckedIndexInput<RecordType, Inputs[Index]>
    : never;
};

type CheckedTableDefinition<
  RecordType extends object,
  TableName extends string,
  Definition extends TableDefinitionInput,
> = {
  readonly primaryKey: Definition['primaryKey'] &
    CheckedPrimaryKeyInput<RecordType, TableName, Definition['primaryKey']>;
  readonly indexes: Definition['indexes'] & CheckedIndexInputs<RecordType, Definition['indexes']>;
};

const tableCreationToken = Symbol('table-creation');
const entityConstructors = new WeakMap<object, EntityConstructor<object>>();

export class Table<
  Name extends string,
  RecordType extends object,
  Primary extends PrimaryKey,
  Indexes extends readonly TableIndex[],
  ModelType extends object = RecordType,
> {
  public readonly kind = 'table';

  declare private readonly recordType: RecordType;
  declare private readonly modelType: ModelType;

  private constructor(
    public readonly name: Name,
    public readonly primaryKey: Primary,
    public readonly indexes: Indexes,
  ) {
    Object.freeze(this);
  }

  public field<const Path extends string>(
    path: Path & FieldPath<RecordType, Path>,
  ): Field<Name, RecordType, Path, FieldValue<RecordType, Path>> {
    return createFieldValue<Name, RecordType, Path, FieldValue<RecordType, Path>>(this.name, path);
  }

  /** @internal */
  public static create<
    Name extends string,
    RecordType extends object,
    Primary extends PrimaryKey,
    Indexes extends readonly TableIndex[],
    ModelType extends object,
  >(
    token: typeof tableCreationToken,
    name: Name,
    primaryKey: Primary,
    indexes: Indexes,
    entity?: EntityConstructor<ModelType>,
  ): Table<Name, RecordType, Primary, Indexes, ModelType> {
    if (token !== tableCreationToken) {
      throw new TypeError('Table can only be created by table');
    }

    const table = new Table<Name, RecordType, Primary, Indexes, ModelType>(name, primaryKey, indexes);

    if (entity !== undefined) {
      entityConstructors.set(table, entity as EntityConstructor<object>);
    }

    return table;
  }
}

export type SchemaTable = {
  readonly kind: 'table';
  readonly name: string;
  readonly primaryKey: PrimaryKey;
  readonly indexes: readonly TableIndex[];
};

export type TableRecord<Type> =
  Type extends Table<string, infer RecordType, PrimaryKey, readonly TableIndex[], infer _ModelType>
    ? RecordType
    : never;

export type TableModel<Type> =
  Type extends Table<string, infer _RecordType, PrimaryKey, readonly TableIndex[], infer ModelType>
    ? ModelType
    : never;

export type TableKey<Type> = Type extends {
  readonly primaryKey: infer Primary extends PrimaryKey;
}
  ? PrimaryKeyValue<Primary>
  : never;

class TableDefinitionBuilder<Name extends string, RecordType extends object, ModelType extends object = RecordType> {
  declare private readonly recordType: RecordType;
  declare private readonly modelType: ModelType;

  public constructor(
    private readonly name: Name,
    private readonly entity?: EntityConstructor<ModelType>,
  ) {
    Object.freeze(this);
  }

  public define<const Definition extends TableDefinitionInput>(
    definition: Definition & CheckedTableDefinition<RecordType, Name, Definition>,
  ): Table<
    Name,
    RecordType,
    PrimaryKeyFromInput<RecordType, Name, Definition['primaryKey']>,
    TableIndexesFromInput<RecordType, Name, Definition['indexes']>,
    ModelType
  > {
    validateTableDefinition(this.name, definition);

    const primaryKey = createPrimaryKeyValue<RecordType, Name>(this.name, definition.primaryKey) as PrimaryKeyFromInput<
      RecordType,
      Name,
      Definition['primaryKey']
    >;
    const indexes = Object.freeze(
      definition.indexes.map((input) => createIndexValue<RecordType, Name>(this.name, input)),
    ) as TableIndexesFromInput<RecordType, Name, Definition['indexes']>;

    return Table.create<
      Name,
      RecordType,
      PrimaryKeyFromInput<RecordType, Name, Definition['primaryKey']>,
      TableIndexesFromInput<RecordType, Name, Definition['indexes']>,
      ModelType
    >(tableCreationToken, this.name, primaryKey, indexes, this.entity);
  }
}

class TableRecordBuilder<Name extends string> {
  public constructor(private readonly name: Name) {
    Object.freeze(this);
  }

  public record<RecordType extends object>(
    ..._arguments: RecordArguments<RecordType>
  ): TableDefinitionBuilder<Name, RecordType> {
    return new TableDefinitionBuilder<Name, RecordType>(this.name);
  }

  public entity<EntityType extends object>(
    entity: EntityConstructor<EntityType>,
  ): TableDefinitionBuilder<Name, EntityRecord<EntityType>, EntityType> {
    return new TableDefinitionBuilder<Name, EntityRecord<EntityType>, EntityType>(this.name, entity);
  }
}

export const table = <const Name extends string>(name: Name): TableRecordBuilder<Name> =>
  new TableRecordBuilder<Name>(name);

/** @internal */
export const materialize = <TableType extends SchemaTable>(
  table: TableType,
  record: TableRecord<TableType>,
): TableModel<TableType> => {
  const entity = entityConstructors.get(table);

  if (entity === undefined) {
    return record as unknown as TableModel<TableType>;
  }

  return Object.assign(new entity(), record) as unknown as TableModel<TableType>;
};
