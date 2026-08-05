type Nullish = null | undefined;

type MissingPathValue<Value> = Extract<Value, Nullish> extends never ? never : undefined;

type NonTraversableObject =
  | Date
  | ArrayBuffer
  | ArrayBufferView<ArrayBuffer>
  | ReadonlyMap<unknown, unknown>
  | ReadonlySet<unknown>
  | RegExp
  | Error
  | Promise<unknown>
  | ((...arguments_: never[]) => unknown);

type FieldKey<Value> =
  NonNullable<Value> extends string
    ? 'length'
    : NonNullable<Value> extends readonly unknown[]
      ? 'length'
      : NonNullable<Value> extends File
        ? 'name' | 'lastModified' | 'size' | 'type'
        : NonNullable<Value> extends Blob
          ? 'size' | 'type'
          : NonNullable<Value> extends NonTraversableObject
            ? never
            : NonNullable<Value> extends object
              ? Extract<keyof NonNullable<Value>, string>
              : never;

type ValueAt<Value, Key extends string> =
  NonNullable<Value> extends string
    ? Key extends 'length'
      ? number
      : never
    : NonNullable<Value> extends readonly unknown[]
      ? Key extends 'length'
        ? number
        : never
      : NonNullable<Value> extends object
        ? Key extends keyof NonNullable<Value>
          ? NonNullable<Value>[Key]
          : never
        : never;

export type FieldPath<RecordType, Path extends string> = Path extends ''
  ? never
  : Path extends `${infer Head}.${infer Tail}`
    ? Tail extends ''
      ? never
      : Head extends FieldKey<RecordType>
        ? FieldPath<ValueAt<RecordType, Head>, Tail> extends never
          ? never
          : Path
        : never
    : Path extends FieldKey<RecordType>
      ? Path
      : never;

export type FieldValue<RecordType, Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends FieldKey<RecordType>
    ? FieldValue<ValueAt<RecordType, Head>, Tail> | MissingPathValue<RecordType>
    : never
  : Path extends FieldKey<RecordType>
    ? ValueAt<RecordType, Path> | MissingPathValue<RecordType>
    : never;

const fieldCreationToken = Symbol('field-creation');

export class Field<TableName extends string, RecordType extends object, Path extends string, Value> {
  public readonly kind = 'field';

  declare private readonly recordType: RecordType;
  declare private readonly valueType: Value;

  private constructor(
    public readonly tableName: TableName,
    public readonly path: Path,
  ) {
    Object.freeze(this);
  }

  /** @internal */
  public static create<TableName extends string, RecordType extends object, Path extends string, Value>(
    token: typeof fieldCreationToken,
    tableName: TableName,
    path: Path,
  ): Field<TableName, RecordType, Path, Value> {
    if (token !== fieldCreationToken) {
      throw new TypeError('Field can only be created by its table');
    }

    return new Field<TableName, RecordType, Path, Value>(tableName, path);
  }
}

/** @internal */
export const createFieldValue = <TableName extends string, RecordType extends object, Path extends string, Value>(
  tableName: TableName,
  path: Path,
): Field<TableName, RecordType, Path, Value> =>
  Field.create<TableName, RecordType, Path, Value>(fieldCreationToken, tableName, path);

/** @internal */
export const createField =
  <RecordType extends object>() =>
  <const TableName extends string, const Path extends string>(
    tableName: TableName,
    path: Path & FieldPath<RecordType, Path>,
  ): Field<TableName, RecordType, Path, FieldValue<RecordType, Path>> =>
    createFieldValue<TableName, RecordType, Path, FieldValue<RecordType, Path>>(tableName, path);
