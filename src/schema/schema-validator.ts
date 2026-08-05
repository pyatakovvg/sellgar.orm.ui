import { SchemaValidationError } from './schema-validation-error.ts';
import type { SchemaValidationCode, SchemaValidationPath } from './schema-validation-error.ts';

type UnknownRecord = Record<string, unknown>;

type KeyPathMetadata = {
  readonly kind: 'simple' | 'compound';
  readonly signature: string;
};

const identifierName = /^[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*$/u;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function fail(code: SchemaValidationCode, path: SchemaValidationPath, message: string): never {
  throw new SchemaValidationError(code, path, message);
}

function assertFrozen(value: object, code: SchemaValidationCode, path: SchemaValidationPath, subject: string): void {
  if (!Object.isFrozen(value)) {
    fail(code, path, `${subject} must be immutable`);
  }
}

const validateSchemaName = (value: unknown, path: SchemaValidationPath): void => {
  if (typeof value !== 'string') {
    fail('invalid-schema-name', path, 'Schema name must be a string');
  }
};

function validateTableName(value: unknown, path: SchemaValidationPath): asserts value is string {
  if (typeof value !== 'string') {
    fail('invalid-table-name', path, 'Table name must be a string');
  }
}

function validateFieldPath(value: unknown, path: SchemaValidationPath): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !value.split('.').every((component) => identifierName.test(component))
  ) {
    fail('invalid-key-path', path, 'Field path must be a non-empty IndexedDB key path');
  }
}

const validateKeyPathInput = (value: unknown, path: SchemaValidationPath): KeyPathMetadata => {
  if (typeof value === 'string') {
    validateFieldPath(value, path);

    return {
      kind: 'simple',
      signature: JSON.stringify([value]),
    };
  }

  if (!Array.isArray(value) || value.length < 2) {
    fail('invalid-key-path', path, 'Compound key path must contain at least two field paths');
  }

  value.forEach((component, index) => validateFieldPath(component, [...path, index]));

  return {
    kind: 'compound',
    signature: JSON.stringify(value),
  };
};

const validateGeneration = (value: unknown, path: SchemaValidationPath): 'assigned' | 'autoIncrement' => {
  if (value !== 'assigned' && value !== 'autoIncrement') {
    fail('invalid-primary-key', path, 'Primary key generation must be assigned or autoIncrement');
  }

  return value;
};

const validatePrimaryKeyInput = (value: unknown, path: SchemaValidationPath): void => {
  if (typeof value === 'string' || Array.isArray(value)) {
    validateKeyPathInput(value, path);
    return;
  }

  if (!isRecord(value)) {
    fail('invalid-primary-key', path, 'Primary key must describe a record or external key');
  }

  if (value.kind === 'external-primary-key' || value.source === 'external') {
    if (value.kind !== 'external-primary-key' || value.source !== 'external' || 'keyPath' in value) {
      fail('invalid-primary-key', path, 'External primary key metadata is inconsistent');
    }

    validateGeneration(value.generation, [...path, 'generation']);
    return;
  }

  if (value.source !== 'record') {
    fail('invalid-primary-key', [...path, 'source'], 'Record primary key source must be record');
  }

  const generation =
    value.generation === undefined ? 'assigned' : validateGeneration(value.generation, [...path, 'generation']);
  const keyPath = validateKeyPathInput(value.keyPath, [...path, 'keyPath']);

  if (generation === 'autoIncrement' && keyPath.kind === 'compound') {
    fail(
      'invalid-auto-increment',
      [...path, 'keyPath'],
      'Record auto-increment primary key cannot use a compound key path',
    );
  }
};

const validateIndexInput = (value: unknown, path: SchemaValidationPath): string => {
  if (!isRecord(value)) {
    fail('invalid-index', path, 'Index must be an object');
  }

  const keyPath = validateKeyPathInput(value.keyPath, [...path, 'keyPath']);

  if (value.unique !== undefined && typeof value.unique !== 'boolean') {
    fail('invalid-index', [...path, 'unique'], 'Index unique option must be boolean');
  }

  if (value.multiEntry !== undefined && typeof value.multiEntry !== 'boolean') {
    fail('invalid-index', [...path, 'multiEntry'], 'Index multiEntry option must be boolean');
  }

  const unique = value.unique ?? false;
  const multiEntry = value.multiEntry ?? false;

  if (multiEntry === true && keyPath.kind === 'compound') {
    fail('invalid-multi-entry', [...path, 'keyPath'], 'Multi-entry index cannot use a compound key path');
  }

  return JSON.stringify([keyPath.signature, unique, multiEntry]);
};

const validateFieldMetadata = (value: unknown, tableName: string, path: SchemaValidationPath): string => {
  if (!isRecord(value) || value.kind !== 'field') {
    fail('invalid-key-path', path, 'Key path field metadata is invalid');
  }

  assertFrozen(value, 'invalid-key-path', path, 'Key path field');

  if (value.tableName !== tableName) {
    fail('invalid-key-path', [...path, 'tableName'], 'Key path field belongs to another table');
  }

  validateFieldPath(value.path, [...path, 'path']);
  return value.path;
};

const validateKeyPathMetadata = (value: unknown, tableName: string, path: SchemaValidationPath): KeyPathMetadata => {
  if (!isRecord(value)) {
    fail('invalid-key-path', path, 'Key path metadata is invalid');
  }

  assertFrozen(value, 'invalid-key-path', path, 'Key path');

  if (value.kind === 'simple-key-path') {
    const fieldPath = validateFieldMetadata(value.field, tableName, [...path, 'field']);

    return {
      kind: 'simple',
      signature: JSON.stringify([fieldPath]),
    };
  }

  if (value.kind !== 'compound-key-path' || !Array.isArray(value.fields) || value.fields.length < 2) {
    fail('invalid-key-path', path, 'Compound key path must contain at least two fields');
  }

  assertFrozen(value.fields, 'invalid-key-path', [...path, 'fields'], 'Compound key path fields');
  const fieldPaths = value.fields.map((field, index) =>
    validateFieldMetadata(field, tableName, [...path, 'fields', index]),
  );

  return {
    kind: 'compound',
    signature: JSON.stringify(fieldPaths),
  };
};

const validatePrimaryKeyMetadata = (value: unknown, tableName: string, path: SchemaValidationPath): void => {
  if (!isRecord(value)) {
    fail('invalid-primary-key', path, 'Primary key metadata is invalid');
  }

  assertFrozen(value, 'invalid-primary-key', path, 'Primary key');
  const generation = validateGeneration(value.generation, [...path, 'generation']);

  if (value.kind === 'external-primary-key' && value.source === 'external') {
    if ('keyPath' in value) {
      fail('invalid-primary-key', path, 'External primary key cannot contain a key path');
    }

    return;
  }

  if (value.kind !== 'record-primary-key' || value.source !== 'record') {
    fail('invalid-primary-key', path, 'Primary key kind and source are inconsistent');
  }

  const keyPath = validateKeyPathMetadata(value.keyPath, tableName, [...path, 'keyPath']);

  if (generation === 'autoIncrement' && keyPath.kind === 'compound') {
    fail(
      'invalid-auto-increment',
      [...path, 'keyPath'],
      'Record auto-increment primary key cannot use a compound key path',
    );
  }
};

const validateIndexMetadata = (value: unknown, tableName: string, path: SchemaValidationPath): string => {
  if (!isRecord(value) || value.kind !== 'index') {
    fail('invalid-index', path, 'Index metadata is invalid');
  }

  assertFrozen(value, 'invalid-index', path, 'Index');

  if (typeof value.unique !== 'boolean') {
    fail('invalid-index', [...path, 'unique'], 'Index unique option must be boolean');
  }

  if (typeof value.multiEntry !== 'boolean') {
    fail('invalid-index', [...path, 'multiEntry'], 'Index multiEntry option must be boolean');
  }

  const keyPath = validateKeyPathMetadata(value.keyPath, tableName, [...path, 'keyPath']);

  if (value.multiEntry && keyPath.kind === 'compound') {
    fail('invalid-multi-entry', [...path, 'keyPath'], 'Multi-entry index cannot use a compound key path');
  }

  return JSON.stringify([keyPath.signature, value.unique, value.multiEntry]);
};

const validateIndexes = (values: unknown, tableName: string, path: SchemaValidationPath, normalized: boolean): void => {
  if (!Array.isArray(values)) {
    fail('invalid-index', path, 'Table indexes must be an array');
  }

  if (normalized) {
    assertFrozen(values, 'invalid-index', path, 'Table indexes');
  }

  const signatures = new Set<string>();

  values.forEach((value, index) => {
    const indexPath = [...path, index];
    const signature = normalized
      ? validateIndexMetadata(value, tableName, indexPath)
      : validateIndexInput(value, indexPath);

    if (signatures.has(signature)) {
      fail('duplicate-index', indexPath, 'Table contains a duplicate index');
    }

    signatures.add(signature);
  });
};

const validateTableMetadata = (value: unknown, path: SchemaValidationPath): string => {
  if (!isRecord(value) || value.kind !== 'table') {
    fail('invalid-table', path, 'Schema table metadata is invalid');
  }

  assertFrozen(value, 'invalid-table', path, 'Table');
  validateTableName(value.name, [...path, 'name']);
  validatePrimaryKeyMetadata(value.primaryKey, value.name, [...path, 'primaryKey']);
  validateIndexes(value.indexes, value.name, [...path, 'indexes'], true);

  return value.name;
};

export const validateTableDefinition = (tableName: unknown, definition: unknown): void => {
  validateTableName(tableName, ['name']);

  if (!isRecord(definition)) {
    fail('invalid-table', [], 'Table definition must be an object');
  }

  validatePrimaryKeyInput(definition.primaryKey, ['primaryKey']);
  validateIndexes(definition.indexes, tableName, ['indexes'], false);
};

export const validateSchemaDefinition = (definition: unknown): void => {
  if (!isRecord(definition)) {
    fail('invalid-schema', [], 'Schema definition must be an object');
  }

  validateSchemaName(definition.name, ['name']);

  if (definition.version !== 1) {
    fail('invalid-schema-version', ['version'], 'First ORM version requires schema version 1');
  }

  if (!Array.isArray(definition.tables) || definition.tables.length === 0) {
    fail('invalid-schema', ['tables'], 'Schema must contain at least one table');
  }

  const tableNames = new Set<string>();

  definition.tables.forEach((table, index) => {
    const tablePath = ['tables', index] as const;
    const tableName = validateTableMetadata(table, tablePath);

    if (tableNames.has(tableName)) {
      fail('duplicate-table', [...tablePath, 'name'], 'Schema contains a duplicate table name');
    }

    tableNames.add(tableName);
  });
};
