import type { CompiledIndex } from './compiled-schema.ts';

type IndexIdentity = Pick<CompiledIndex, 'keyPath' | 'unique' | 'multiEntry'>;

export const createIndexName = ({ keyPath, unique, multiEntry }: IndexIdentity): string =>
  JSON.stringify([keyPath, unique, multiEntry]);
