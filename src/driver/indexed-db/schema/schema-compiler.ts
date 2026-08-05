import { Schema } from '../../../schema';
import type { KeyPath, PrimaryKey, SchemaTable, TableIndex } from '../../../schema';

import { createCompiledSchema } from './compiled-schema.ts';
import type { CompiledIndex, CompiledKeyPath, CompiledSchema, CompiledStore } from './compiled-schema.ts';
import { createIndexName } from './index-name.ts';

const compileKeyPath = (keyPath: KeyPath): CompiledKeyPath => {
  if (keyPath.kind === 'simple-key-path') {
    return keyPath.field.path;
  }

  return keyPath.fields.map((field) => field.path);
};

const compilePrimaryKey = (primaryKey: PrimaryKey): Pick<CompiledStore, 'keyPath' | 'autoIncrement'> => ({
  keyPath: primaryKey.source === 'external' ? null : compileKeyPath(primaryKey.keyPath),
  autoIncrement: primaryKey.generation === 'autoIncrement',
});

export const compileIndex = (index: TableIndex): CompiledIndex => {
  const keyPath = compileKeyPath(index.keyPath);

  return {
    name: createIndexName({
      keyPath,
      unique: index.unique,
      multiEntry: index.multiEntry,
    }),
    keyPath,
    unique: index.unique,
    multiEntry: index.multiEntry,
  };
};

const compileStore = (table: SchemaTable): CompiledStore => ({
  name: table.name,
  ...compilePrimaryKey(table.primaryKey),
  indexes: table.indexes.map(compileIndex),
});

export const compileSchema = (schema: Schema): CompiledSchema =>
  createCompiledSchema({
    name: schema.name,
    version: schema.version,
    stores: schema.tables.map(compileStore),
  });
