import type { SchemaTable } from './table.ts';
import { validateSchemaDefinition } from './schema-validator.ts';

type NonEmptyTables = readonly [SchemaTable, ...SchemaTable[]];
type ImmutableTables<Tables extends NonEmptyTables> = readonly [...Tables];

const schemaCreationToken = Symbol('schema-creation');

export class Schema<Name extends string = string, Tables extends NonEmptyTables = NonEmptyTables> {
  public readonly kind: 'schema' = 'schema';
  public readonly version: 1 = 1;

  private constructor(
    public readonly name: Name,
    public readonly tables: Tables,
  ) {
    Object.freeze(this);
  }

  /** @internal */
  public static create<Name extends string, Tables extends NonEmptyTables>(
    token: typeof schemaCreationToken,
    name: Name,
    tables: Tables,
  ): Schema<Name, Tables> {
    if (token !== schemaCreationToken) {
      throw new TypeError('Schema can only be created by schema');
    }

    return new Schema<Name, Tables>(name, tables);
  }
}

export type SchemaTables<Type> = Type extends Schema<string, infer Tables> ? Tables : never;

export type SchemaTableUnion<Type> = SchemaTables<Type> extends NonEmptyTables ? SchemaTables<Type>[number] : never;

export const schema = <const Name extends string, const Tables extends NonEmptyTables>(definition: {
  readonly name: Name;
  readonly version: 1;
  readonly tables: Tables;
}): Schema<Name, ImmutableTables<Tables>> => {
  validateSchemaDefinition(definition);

  const tables = Object.freeze([...definition.tables]) as unknown as ImmutableTables<Tables>;

  return Schema.create<Name, ImmutableTables<Tables>>(schemaCreationToken, definition.name, tables);
};
