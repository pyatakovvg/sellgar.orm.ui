import type { StorageKey } from '../key';
import type { SchemaTable } from '../schema';
import type { WriteEntry } from './mutation.ts';

export type NormalizedWrite = Readonly<{
  entries: readonly WriteEntry[];
  multiple: boolean;
}>;

const record = (value: unknown): WriteEntry => [value];

const tuple = (value: unknown): WriteEntry => {
  const [entry, key] = value as readonly [record: unknown, key: StorageKey];

  return [entry, key];
};

export const normalizeWrite = (
  table: SchemaTable,
  arguments_: readonly unknown[],
  operation: 'insert' | 'upsert',
): NormalizedWrite => {
  const multiple = arguments_.length === 1 && Array.isArray(arguments_[0]);

  if (!multiple) {
    const key = arguments_[1];

    return {
      entries: [arguments_.length < 2 || key === undefined ? record(arguments_[0]) : [arguments_[0], key as StorageKey]],
      multiple: false,
    };
  }

  const values = arguments_[0] as readonly unknown[];
  const primary = table.primaryKey;
  const entries =
    primary.source === 'record'
      ? values.map(record)
      : primary.generation === 'assigned'
        ? values.map(tuple)
        : operation === 'upsert'
          ? values.map((value) => (Array.isArray(value) ? tuple(value) : record(value)))
          : values.map(record);

  return {
    entries,
    multiple: true,
  };
};

