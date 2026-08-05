import { eq, Expression } from '../expression/index.ts';
import type { EqualityValue } from '../expression/index.ts';
import type { StorageKey } from '../key/index.ts';
import { CompoundKeyPath, ExternalPrimaryKey, RecordPrimaryKey, SimpleKeyPath } from '../schema/index.ts';
import type {
  Field,
  SchemaTable,
  TableKey,
  TableRecord,
} from '../schema/index.ts';
import { selection, Selection } from '../selection/index.ts';

type PrimaryKeyOf<TableType extends SchemaTable> = TableType['primaryKey'];

type Simplify<Value> = {
  [Key in keyof Value]: Value[Key];
};

type WithoutPath<Value, Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof Value
    ? {
        [Key in keyof Value]: Key extends Head ? WithoutPath<Value[Key], Tail> : Value[Key];
      }
    : Value
  : Path extends keyof Value
    ? Omit<Value, Path>
    : Value;

type WithOptionalPath<Value, Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof Value
    ? {
        [Key in keyof Value]: Key extends Head ? WithOptionalPath<Value[Key], Tail> : Value[Key];
      }
    : Value
  : Path extends keyof Value
    ? Simplify<Omit<Value, Path> & Partial<Pick<Value, Path>>>
    : Value;

type AutoIncrementRecordPath<Primary> =
  Primary extends RecordPrimaryKey<number, 'autoIncrement', infer Path>
    ? Path extends SimpleKeyPath<StorageKey, string, object, infer FieldPath>
      ? FieldPath
      : never
    : never;

export type InsertRecord<TableType extends SchemaTable> =
  AutoIncrementRecordPath<PrimaryKeyOf<TableType>> extends infer Path extends string
    ? [Path] extends [never]
      ? TableRecord<TableType>
      : WithoutPath<TableRecord<TableType>, Path>
    : never;

export type UpsertRecord<TableType extends SchemaTable> =
  AutoIncrementRecordPath<PrimaryKeyOf<TableType>> extends infer Path extends string
    ? [Path] extends [never]
      ? TableRecord<TableType>
      : WithOptionalPath<TableRecord<TableType>, Path>
    : never;

export type InsertArguments<TableType extends SchemaTable> =
  PrimaryKeyOf<TableType> extends ExternalPrimaryKey<infer Key, 'assigned'>
    ? [record: TableRecord<TableType>, key: Key]
    : [record: InsertRecord<TableType>];

export type UpsertArguments<TableType extends SchemaTable> =
  PrimaryKeyOf<TableType> extends ExternalPrimaryKey<infer Key, 'assigned'>
    ? [record: TableRecord<TableType>, key: Key]
    : PrimaryKeyOf<TableType> extends ExternalPrimaryKey<infer Key, 'autoIncrement'>
      ? [record: TableRecord<TableType>, key?: Key]
      : [record: UpsertRecord<TableType>];

export type InsertManyInput<TableType extends SchemaTable> =
  PrimaryKeyOf<TableType> extends ExternalPrimaryKey<infer Key, 'assigned'>
    ? readonly (readonly [record: TableRecord<TableType>, key: Key])[]
    : readonly InsertRecord<TableType>[];

export type UpsertManyInput<TableType extends SchemaTable> =
  PrimaryKeyOf<TableType> extends ExternalPrimaryKey<infer Key, 'assigned'>
    ? readonly (readonly [record: TableRecord<TableType>, key: Key])[]
    : PrimaryKeyOf<TableType> extends ExternalPrimaryKey<infer Key, 'autoIncrement'>
      ? readonly (TableRecord<TableType> | readonly [record: TableRecord<TableType>, key: Key])[]
      : readonly UpsertRecord<TableType>[];

type Root<Path extends string> = Path extends `${infer Head}.${string}` ? Head : Path;

type PrimaryPaths<Primary> =
  Primary extends RecordPrimaryKey<StorageKey, 'assigned' | 'autoIncrement', infer Path>
    ? Path extends SimpleKeyPath<StorageKey, string, object, infer FieldPath>
      ? FieldPath
      : Path extends CompoundKeyPath<readonly StorageKey[], string, object, infer FieldPaths>
        ? FieldPaths[number]
        : never
    : never;

type PrimaryRoots<Primary> = PrimaryPaths<Primary> extends infer Path extends string ? Root<Path> : never;

export type UpdateValues<TableType extends SchemaTable> = Readonly<
  Partial<Omit<TableRecord<TableType>, Extract<PrimaryRoots<PrimaryKeyOf<TableType>>, keyof TableRecord<TableType>>>>
>;

export type WriteEntry = readonly [record: unknown] | readonly [record: unknown, key: StorageKey];

type InsertExecutor<TableType extends SchemaTable> = {
  (...arguments_: InsertArguments<TableType>): Promise<TableKey<TableType>>;
  (entries: InsertManyInput<TableType>): Promise<TableKey<TableType>[]>;
};

type UpsertExecutor<TableType extends SchemaTable> = {
  (...arguments_: UpsertArguments<TableType>): Promise<TableKey<TableType>>;
  (entries: UpsertManyInput<TableType>): Promise<TableKey<TableType>[]>;
};

type UpdateExecutor<TableType extends SchemaTable> = (
  selection: Selection<TableType>,
  values: UpdateValues<TableType>,
) => Promise<number>;

type DeleteExecutor<TableType extends SchemaTable> = (selection: Selection<TableType>) => Promise<number>;

const writeCreationToken = Symbol('write-creation');
const insertCreationToken = Symbol('insert-creation');
const upsertCreationToken = Symbol('upsert-creation');
const updateCreationToken = Symbol('update-creation');
const deleteCreationToken = Symbol('delete-creation');

export abstract class Write<Result> {
  protected constructor(token: typeof writeCreationToken) {
    if (token !== writeCreationToken) {
      throw new TypeError('Write can only be created by a mutation');
    }
  }

  public abstract execute(): Promise<Result>;
}

class PendingWrite<Result> extends Write<Result> {
  public constructor(private readonly operation: () => Promise<Result>) {
    super(writeCreationToken);
    Object.freeze(this);
  }

  public execute(): Promise<Result> {
    return this.operation();
  }
}

export abstract class Insert<TableType extends SchemaTable> {
  protected constructor(token: typeof insertCreationToken) {
    if (token !== insertCreationToken) {
      throw new TypeError('Insert can only be created by a client or transaction');
    }
  }

  public abstract values(...arguments_: InsertArguments<TableType>): Write<TableKey<TableType>>;
  public abstract values(entries: InsertManyInput<TableType>): Write<TableKey<TableType>[]>;
}

class BoundInsert<TableType extends SchemaTable> extends Insert<TableType> {
  public constructor(private readonly execute: InsertExecutor<TableType>) {
    super(insertCreationToken);
    Object.freeze(this);
  }

  public values(...arguments_: InsertArguments<TableType>): Write<TableKey<TableType>>;
  public values(entries: InsertManyInput<TableType>): Write<TableKey<TableType>[]>;
  public values(
    ...arguments_: InsertArguments<TableType> | [entries: InsertManyInput<TableType>]
  ): Write<TableKey<TableType> | TableKey<TableType>[]> {
    return new PendingWrite<TableKey<TableType> | TableKey<TableType>[]>(() => {
      if (arguments_.length === 1 && Array.isArray(arguments_[0])) {
        return this.execute(arguments_[0] as unknown as InsertManyInput<TableType>) as Promise<
          TableKey<TableType> | TableKey<TableType>[]
        >;
      }

      return this.execute(...(arguments_ as InsertArguments<TableType>)) as Promise<
        TableKey<TableType> | TableKey<TableType>[]
      >;
    });
  }
}

export abstract class Upsert<TableType extends SchemaTable> {
  protected constructor(token: typeof upsertCreationToken) {
    if (token !== upsertCreationToken) {
      throw new TypeError('Upsert can only be created by a client or transaction');
    }
  }

  public abstract values(...arguments_: UpsertArguments<TableType>): Write<TableKey<TableType>>;
  public abstract values(entries: UpsertManyInput<TableType>): Write<TableKey<TableType>[]>;
}

class BoundUpsert<TableType extends SchemaTable> extends Upsert<TableType> {
  public constructor(private readonly execute: UpsertExecutor<TableType>) {
    super(upsertCreationToken);
    Object.freeze(this);
  }

  public values(...arguments_: UpsertArguments<TableType>): Write<TableKey<TableType>>;
  public values(entries: UpsertManyInput<TableType>): Write<TableKey<TableType>[]>;
  public values(
    ...arguments_: UpsertArguments<TableType> | [entries: UpsertManyInput<TableType>]
  ): Write<TableKey<TableType> | TableKey<TableType>[]> {
    return new PendingWrite<TableKey<TableType> | TableKey<TableType>[]>(() => {
      if (arguments_.length === 1 && Array.isArray(arguments_[0])) {
        return this.execute(arguments_[0] as unknown as UpsertManyInput<TableType>) as Promise<
          TableKey<TableType> | TableKey<TableType>[]
        >;
      }

      return this.execute(...(arguments_ as UpsertArguments<TableType>)) as Promise<
        TableKey<TableType> | TableKey<TableType>[]
      >;
    });
  }
}

type FilterState<TableType extends SchemaTable> = Readonly<{
  selection: Selection<TableType>;
}>;

const where = <TableType extends SchemaTable, Path extends string, Value>(
  current: Selection<TableType>,
  expressionOrField:
    | Expression<TableType['name'], TableRecord<TableType>>
    | Field<TableType['name'], TableRecord<TableType>, Path, Value>,
  value?: NoInfer<EqualityValue<Value>>,
): Selection<TableType> =>
  current.where(
    expressionOrField instanceof Expression
      ? expressionOrField
      : eq(expressionOrField, value as NoInfer<EqualityValue<Value>>),
  );

export abstract class Update<TableType extends SchemaTable> {
  protected constructor(token: typeof updateCreationToken) {
    if (token !== updateCreationToken) {
      throw new TypeError('Update can only be created by a client or transaction');
    }
  }

  public abstract set(values: UpdateValues<TableType>): UpdateWhere<TableType>;
}

export abstract class UpdateWhere<TableType extends SchemaTable> {
  public abstract where(
    expression: Expression<TableType['name'], TableRecord<TableType>>,
  ): UpdateExecution<TableType>;
  public abstract where<Path extends string, Value>(
    field: Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value: NoInfer<EqualityValue<Value>>,
  ): UpdateExecution<TableType>;
}

export abstract class UpdateExecution<TableType extends SchemaTable> extends UpdateWhere<TableType> {
  public abstract execute(): Promise<number>;
}

class BoundUpdate<TableType extends SchemaTable> extends Update<TableType> {
  public constructor(
    private readonly table: TableType,
    private readonly execute: UpdateExecutor<TableType>,
  ) {
    super(updateCreationToken);
    Object.freeze(this);
  }

  public set(values: UpdateValues<TableType>): UpdateWhere<TableType> {
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      throw new TypeError('Update values are invalid');
    }

    if (this.table.primaryKey instanceof RecordPrimaryKey) {
      const keyPath = this.table.primaryKey.keyPath;
      const paths =
        keyPath instanceof SimpleKeyPath
          ? [keyPath.field.path]
          : keyPath instanceof CompoundKeyPath
            ? keyPath.fields.map(({ path }) => path)
            : [];

      if (paths.some((path) => Object.hasOwn(values, path.split('.')[0]))) {
        throw new TypeError('Primary key cannot be updated');
      }
    }

    return new PendingUpdate(selection(this.table), Object.freeze({ ...values }), this.execute);
  }
}

class PendingUpdate<TableType extends SchemaTable> extends UpdateWhere<TableType> {
  public constructor(
    private readonly current: Selection<TableType>,
    private readonly values: UpdateValues<TableType>,
    private readonly run: UpdateExecutor<TableType>,
  ) {
    super();
    Object.freeze(this);
  }

  public where(
    expression: Expression<TableType['name'], TableRecord<TableType>>,
  ): UpdateExecution<TableType>;
  public where<Path extends string, Value>(
    field: Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value: NoInfer<EqualityValue<Value>>,
  ): UpdateExecution<TableType>;
  public where<Path extends string, Value>(
    expressionOrField:
      | Expression<TableType['name'], TableRecord<TableType>>
      | Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value?: NoInfer<EqualityValue<Value>>,
  ): UpdateExecution<TableType> {
    return new ExecutableUpdate(where(this.current, expressionOrField, value), this.values, this.run);
  }
}

class ExecutableUpdate<TableType extends SchemaTable> extends UpdateExecution<TableType> {
  public constructor(
    private readonly current: Selection<TableType>,
    private readonly values: UpdateValues<TableType>,
    private readonly run: UpdateExecutor<TableType>,
  ) {
    super();
    Object.freeze(this);
  }

  public where(
    expression: Expression<TableType['name'], TableRecord<TableType>>,
  ): UpdateExecution<TableType>;
  public where<Path extends string, Value>(
    field: Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value: NoInfer<EqualityValue<Value>>,
  ): UpdateExecution<TableType>;
  public where<Path extends string, Value>(
    expressionOrField:
      | Expression<TableType['name'], TableRecord<TableType>>
      | Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value?: NoInfer<EqualityValue<Value>>,
  ): UpdateExecution<TableType> {
    return new ExecutableUpdate(where(this.current, expressionOrField, value), this.values, this.run);
  }

  public execute(): Promise<number> {
    return this.run(this.current, this.values);
  }
}

export abstract class Delete<TableType extends SchemaTable> {
  protected constructor(token: typeof deleteCreationToken) {
    if (token !== deleteCreationToken) {
      throw new TypeError('Delete can only be created by a client or transaction');
    }
  }

  public abstract where(
    expression: Expression<TableType['name'], TableRecord<TableType>>,
  ): DeleteExecution<TableType>;
  public abstract where<Path extends string, Value>(
    field: Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value: NoInfer<EqualityValue<Value>>,
  ): DeleteExecution<TableType>;
}

export abstract class DeleteExecution<TableType extends SchemaTable> extends Delete<TableType> {
  public abstract execute(): Promise<number>;
}

class PendingDelete<TableType extends SchemaTable> extends Delete<TableType> {
  public constructor(
    private readonly current: Selection<TableType>,
    private readonly run: DeleteExecutor<TableType>,
  ) {
    super(deleteCreationToken);
    Object.freeze(this);
  }

  public where(
    expression: Expression<TableType['name'], TableRecord<TableType>>,
  ): DeleteExecution<TableType>;
  public where<Path extends string, Value>(
    field: Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value: NoInfer<EqualityValue<Value>>,
  ): DeleteExecution<TableType>;
  public where<Path extends string, Value>(
    expressionOrField:
      | Expression<TableType['name'], TableRecord<TableType>>
      | Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value?: NoInfer<EqualityValue<Value>>,
  ): DeleteExecution<TableType> {
    return new ExecutableDelete(where(this.current, expressionOrField, value), this.run);
  }
}

class ExecutableDelete<TableType extends SchemaTable> extends DeleteExecution<TableType> {
  public constructor(
    private readonly current: Selection<TableType>,
    private readonly run: DeleteExecutor<TableType>,
  ) {
    super(deleteCreationToken);
    Object.freeze(this);
  }

  public where(
    expression: Expression<TableType['name'], TableRecord<TableType>>,
  ): DeleteExecution<TableType>;
  public where<Path extends string, Value>(
    field: Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value: NoInfer<EqualityValue<Value>>,
  ): DeleteExecution<TableType>;
  public where<Path extends string, Value>(
    expressionOrField:
      | Expression<TableType['name'], TableRecord<TableType>>
      | Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value?: NoInfer<EqualityValue<Value>>,
  ): DeleteExecution<TableType> {
    return new ExecutableDelete(where(this.current, expressionOrField, value), this.run);
  }

  public execute(): Promise<number> {
    return this.run(this.current);
  }
}

export const createInsert = <TableType extends SchemaTable>(
  execute: InsertExecutor<TableType>,
): Insert<TableType> => new BoundInsert(execute);

export const createUpsert = <TableType extends SchemaTable>(
  execute: UpsertExecutor<TableType>,
): Upsert<TableType> => new BoundUpsert(execute);

export const createUpdate = <TableType extends SchemaTable>(
  table: TableType,
  execute: UpdateExecutor<TableType>,
): Update<TableType> => new BoundUpdate(table, execute);

export const createDelete = <TableType extends SchemaTable>(
  table: TableType,
  execute: DeleteExecutor<TableType>,
): Delete<TableType> => new PendingDelete(selection(table), execute);
