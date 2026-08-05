import { OperationError } from '../error';

export type SchemaValidationCode =
  | 'invalid-schema'
  | 'invalid-schema-name'
  | 'invalid-schema-version'
  | 'invalid-table'
  | 'invalid-table-name'
  | 'duplicate-table'
  | 'invalid-primary-key'
  | 'invalid-key-path'
  | 'invalid-index'
  | 'duplicate-index'
  | 'invalid-auto-increment'
  | 'invalid-multi-entry';

export type SchemaValidationPath = readonly (string | number)[];

export class SchemaValidationError extends OperationError<SchemaValidationCode> {
  public override readonly name = 'SchemaValidationError';
  public readonly path: SchemaValidationPath;

  public constructor(code: SchemaValidationCode, path: SchemaValidationPath, message: string) {
    super(code, 'schema.validate', message);
    this.path = Object.freeze([...path]);
  }
}
