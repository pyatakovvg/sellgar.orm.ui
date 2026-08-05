import type { CompiledKeyPath, CompiledSchema } from './compiled-schema.ts';

const toNativeKeyPath = (keyPath: CompiledKeyPath): string | string[] =>
  typeof keyPath === 'string' ? keyPath : [...keyPath];

export const installSchema = (database: IDBDatabase, schema: CompiledSchema): void => {
  for (const store of schema.stores) {
    const objectStore = database.createObjectStore(store.name, {
      keyPath: store.keyPath === null ? null : toNativeKeyPath(store.keyPath),
      autoIncrement: store.autoIncrement,
    });

    for (const index of store.indexes) {
      objectStore.createIndex(index.name, toNativeKeyPath(index.keyPath), {
        unique: index.unique,
        multiEntry: index.multiEntry,
      });
    }
  }
};
