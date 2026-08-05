export type CompiledKeyPath = string | readonly string[];

export interface CompiledIndex {
  readonly name: string;
  readonly keyPath: CompiledKeyPath;
  readonly unique: boolean;
  readonly multiEntry: boolean;
}

export interface CompiledStore {
  readonly name: string;
  readonly keyPath: CompiledKeyPath | null;
  readonly autoIncrement: boolean;
  readonly indexes: readonly CompiledIndex[];
}

export interface CompiledSchema {
  readonly name: string;
  readonly version: 1;
  readonly stores: readonly CompiledStore[];
}

const cloneKeyPath = (keyPath: CompiledKeyPath): CompiledKeyPath =>
  typeof keyPath === 'string' ? keyPath : Object.freeze([...keyPath]);

const cloneIndex = (index: CompiledIndex): CompiledIndex =>
  Object.freeze({
    name: index.name,
    keyPath: cloneKeyPath(index.keyPath),
    unique: index.unique,
    multiEntry: index.multiEntry,
  });

const cloneStore = (store: CompiledStore): CompiledStore =>
  Object.freeze({
    name: store.name,
    keyPath: store.keyPath === null ? null : cloneKeyPath(store.keyPath),
    autoIncrement: store.autoIncrement,
    indexes: Object.freeze(store.indexes.map(cloneIndex)),
  });

export const createCompiledSchema = (value: CompiledSchema): CompiledSchema =>
  Object.freeze({
    name: value.name,
    version: value.version,
    stores: Object.freeze(value.stores.map(cloneStore)),
  });
