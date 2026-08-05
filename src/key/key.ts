export type BinaryStorageKey = ArrayBuffer | ArrayBufferView<ArrayBuffer>;

export type StorageKey = number | string | Date | BinaryStorageKey | readonly StorageKey[];

export type KeyOrder = -1 | 0 | 1;
type KeyKind = Snapshot['kind'];

type NumberSnapshot = Readonly<{
  kind: 'number';
  value: number;
}>;

type DateSnapshot = Readonly<{
  kind: 'date';
  value: number;
}>;

type StringSnapshot = Readonly<{
  kind: 'string';
  value: string;
}>;

type BinarySnapshot = Readonly<{
  kind: 'binary';
  bytes: Uint8Array<ArrayBuffer>;
}>;

type ArraySnapshot = Readonly<{
  kind: 'array';
  values: readonly Snapshot[];
}>;

type Snapshot = NumberSnapshot | DateSnapshot | StringSnapshot | BinarySnapshot | ArraySnapshot;

const invalidKeyMessage = 'Storage key is invalid';
const dateValue = Date.prototype.getTime;
const bufferSlice = ArrayBuffer.prototype.slice;

const snapshotDate = (value: unknown): DateSnapshot | undefined => {
  try {
    const time = dateValue.call(value);

    return Number.isNaN(time)
      ? undefined
      : Object.freeze({
          kind: 'date',
          value: time,
        });
  } catch {
    return undefined;
  }
};

const snapshotBuffer = (value: unknown, start = 0, end?: number): BinarySnapshot | undefined => {
  try {
    const buffer = bufferSlice.call(value, start, end) as ArrayBuffer;

    return Object.freeze({
      kind: 'binary',
      bytes: new Uint8Array(buffer),
    });
  } catch {
    return undefined;
  }
};

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
  if (typeof value === 'number') {
    return Number.isNaN(value)
      ? undefined
      : Object.freeze({
          kind: 'number',
          value,
        });
  }

  if (typeof value === 'string') {
    return Object.freeze({
      kind: 'string',
      value,
    });
  }

  if (Array.isArray(value)) {
    return snapshotArray(value, ancestors);
  }

  if (ArrayBuffer.isView(value)) {
    return snapshotBuffer(value.buffer, value.byteOffset, value.byteOffset + value.byteLength);
  }

  return snapshotDate(value) ?? snapshotBuffer(value);
};

const materialize = (snapshot: Snapshot): StorageKey => {
  switch (snapshot.kind) {
    case 'number':
    case 'string':
      return snapshot.value;
    case 'date':
      return new Date(snapshot.value);
    case 'binary':
      return snapshot.bytes.slice().buffer;
    case 'array':
      return Object.freeze(snapshot.values.map(materialize));
  }
};

const compareNumbers = (left: number, right: number): KeyOrder => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};

const compareStrings = (left: string, right: string): KeyOrder => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};

const compareBytes = (left: Uint8Array<ArrayBuffer>, right: Uint8Array<ArrayBuffer>): KeyOrder => {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const order = compareNumbers(left[index], right[index]);

    if (order !== 0) {
      return order;
    }
  }

  return compareNumbers(left.length, right.length);
};

const kindOrder: Readonly<Record<Snapshot['kind'], number>> = Object.freeze({
  number: 0,
  date: 1,
  string: 2,
  binary: 3,
  array: 4,
});

const compareSnapshots = (left: Snapshot, right: Snapshot): KeyOrder => {
  if (left.kind !== right.kind) {
    return compareNumbers(kindOrder[left.kind], kindOrder[right.kind]);
  }

  switch (left.kind) {
    case 'number':
      return compareNumbers(left.value, (right as NumberSnapshot).value);
    case 'date':
      return compareNumbers(left.value, (right as DateSnapshot).value);
    case 'string':
      return compareStrings(left.value, (right as StringSnapshot).value);
    case 'binary':
      return compareBytes(left.bytes, (right as BinarySnapshot).bytes);
    case 'array': {
      const rightValues = (right as ArraySnapshot).values;
      const length = Math.min(left.values.length, rightValues.length);

      for (let index = 0; index < length; index += 1) {
        const order = compareSnapshots(left.values[index], rightValues[index]);

        if (order !== 0) {
          return order;
        }
      }

      return compareNumbers(left.values.length, rightValues.length);
    }
  }
};

export class Key {
  private constructor(private readonly snapshot: Snapshot) {
    Object.freeze(this);
  }

  public static from(value: StorageKey): Key {
    let snapshot: Snapshot | undefined;

    try {
      snapshot = snapshotValue(value, new Set());
    } catch {
      snapshot = undefined;
    }

    if (snapshot === undefined) {
      throw new TypeError(invalidKeyMessage);
    }

    return new Key(snapshot);
  }

  public get value(): StorageKey {
    return materialize(this.snapshot);
  }

  public get kind(): KeyKind {
    return this.snapshot.kind;
  }

  public compare(other: Key): KeyOrder {
    return compareSnapshots(this.snapshot, other.snapshot);
  }

  public startsWith(prefix: Key): boolean {
    if (this.snapshot.kind !== prefix.snapshot.kind) {
      return false;
    }

    switch (this.snapshot.kind) {
      case 'string':
        return this.snapshot.value.startsWith((prefix.snapshot as StringSnapshot).value);
      case 'binary': {
        const bytes = this.snapshot.bytes;
        const prefixBytes = (prefix.snapshot as BinarySnapshot).bytes;

        return prefixBytes.length <= bytes.length && prefixBytes.every((byte, index) => bytes[index] === byte);
      }
      case 'array': {
        const values = this.snapshot.values;
        const prefixValues = (prefix.snapshot as ArraySnapshot).values;

        return (
          prefixValues.length <= values.length &&
          prefixValues.every((value, index) => compareSnapshots(values[index], value) === 0)
        );
      }
      case 'number':
      case 'date':
        return false;
    }
  }
}
