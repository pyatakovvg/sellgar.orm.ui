import { Key } from '../key/index.ts';
import type { BinaryStorageKey, StorageKey } from '../key/index.ts';

export type Input = number | string | boolean | bigint | Date | BinaryStorageKey | readonly Input[];

type KeySnapshot = Readonly<{
  kind: 'key';
  key: Key;
}>;

type NaNSnapshot = Readonly<{
  kind: 'nan';
}>;

type BooleanSnapshot = Readonly<{
  kind: 'boolean';
  value: boolean;
}>;

type BigIntSnapshot = Readonly<{
  kind: 'bigint';
  value: bigint;
}>;

type ArraySnapshot = Readonly<{
  kind: 'array';
  values: readonly Snapshot[];
}>;

type Snapshot = KeySnapshot | NaNSnapshot | BooleanSnapshot | BigIntSnapshot | ArraySnapshot;

const invalidValueMessage = 'Expression value is invalid';

const snapshotArray = (value: readonly unknown[], ancestors: Set<readonly unknown[]>): ArraySnapshot | undefined => {
  if (ancestors.has(value)) {
    return undefined;
  }

  ancestors.add(value);

  try {
    const values: Snapshot[] = [];

    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        return undefined;
      }

      const item = snapshotValue(value[index], ancestors);

      if (item === undefined) {
        return undefined;
      }

      values.push(item);
    }

    return Object.freeze({
      kind: 'array',
      values: Object.freeze(values),
    });
  } finally {
    ancestors.delete(value);
  }
};

const snapshotValue = (value: unknown, ancestors: Set<readonly unknown[]>): Snapshot | undefined => {
  if (Array.isArray(value)) {
    return snapshotArray(value, ancestors);
  }

  if (typeof value === 'number' && Number.isNaN(value)) {
    return Object.freeze({
      kind: 'nan',
    });
  }

  if (typeof value === 'boolean') {
    return Object.freeze({
      kind: 'boolean',
      value,
    });
  }

  if (typeof value === 'bigint') {
    return Object.freeze({
      kind: 'bigint',
      value,
    });
  }

  try {
    return Object.freeze({
      kind: 'key',
      key: Key.from(value as StorageKey),
    });
  } catch {
    return undefined;
  }
};

const materialize = (snapshot: Snapshot): Input => {
  switch (snapshot.kind) {
    case 'key':
      return snapshot.key.value;
    case 'nan':
      return Number.NaN;
    case 'boolean':
    case 'bigint':
      return snapshot.value;
    case 'array':
      return Object.freeze(snapshot.values.map(materialize));
  }
};

const equals = (left: Snapshot, right: Snapshot): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case 'key':
      return left.key.compare((right as KeySnapshot).key) === 0;
    case 'nan':
      return true;
    case 'boolean':
      return left.value === (right as BooleanSnapshot).value;
    case 'bigint':
      return left.value === (right as BigIntSnapshot).value;
    case 'array': {
      const rightValues = (right as ArraySnapshot).values;

      return (
        left.values.length === rightValues.length &&
        left.values.every((value, index) => equals(value, rightValues[index]))
      );
    }
  }
};

export class Value {
  private constructor(private readonly snapshot: Snapshot) {
    Object.freeze(this);
  }

  public static from(input: Input): Value {
    let snapshot: Snapshot | undefined;

    try {
      snapshot = snapshotValue(input, new Set());
    } catch {
      snapshot = undefined;
    }

    if (snapshot === undefined) {
      throw new TypeError(invalidValueMessage);
    }

    return new Value(snapshot);
  }

  public get value(): Input {
    return materialize(this.snapshot);
  }

  public equals(other: Value): boolean {
    return equals(this.snapshot, other.snapshot);
  }
}
