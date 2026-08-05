import { IDBFactory } from 'fake-indexeddb';

import { Key } from '../index.ts';
import type { BinaryStorageKey, StorageKey } from '../index.ts';

const compare = (left: StorageKey, right: StorageKey): -1 | 0 | 1 => Key.from(left).compare(Key.from(right));

describe('StorageKey', () => {
  it('описывает поддерживаемые browser key types', () => {
    expectTypeOf<number>().toMatchTypeOf<StorageKey>();
    expectTypeOf<string>().toMatchTypeOf<StorageKey>();
    expectTypeOf<Date>().toMatchTypeOf<StorageKey>();
    expectTypeOf<ArrayBuffer>().toMatchTypeOf<StorageKey>();
    expectTypeOf<Uint8Array<ArrayBuffer>>().toMatchTypeOf<BinaryStorageKey>();
    expectTypeOf<readonly [string, number]>().toMatchTypeOf<StorageKey>();
    expectTypeOf<readonly [string, readonly [number, Date]]>().toMatchTypeOf<StorageKey>();
  });

  it('не включает значения вне key domain', () => {
    if (false) {
      // @ts-expect-error boolean не является browser storage key.
      const booleanKey: StorageKey = true;
      // @ts-expect-error bigint не является browser storage key.
      const bigintKey: StorageKey = 1n;
      // @ts-expect-error null не является browser storage key.
      const nullKey: StorageKey = null;
      // @ts-expect-error undefined не является browser storage key.
      const undefinedKey: StorageKey = undefined;
      // @ts-expect-error произвольный object не является browser storage key.
      const objectKey: StorageKey = { id: 'key' };

      expect([booleanKey, bigintKey, nullKey, undefinedKey, objectKey]).toHaveLength(5);
    }

    expect(true).toBe(true);
  });
});

describe('Key', () => {
  it('принимает весь runtime storage-key domain', () => {
    const keys: readonly StorageKey[] = [
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      new Date(0),
      '',
      new Uint8Array([0, 255]),
      [],
      [1, ['nested']],
    ];

    expect(keys.map((key) => Key.from(key).value)).toHaveLength(keys.length);
  });

  it.each([
    ['NaN', Number.NaN],
    ['invalid Date', new Date(Number.NaN)],
    ['boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['object', { id: 'key' }],
  ])('отклоняет %s', (_case, value) => {
    expect(() => Key.from(value as StorageKey)).toThrow(new TypeError('Storage key is invalid'));
  });

  it('отклоняет sparse и cyclic arrays', () => {
    const sparse = new Array<StorageKey>(2);
    sparse[1] = 'defined';
    const undefinedItem = [undefined] as unknown as StorageKey[];

    const direct: StorageKey[] = [];
    direct.push(direct);

    const indirect: StorageKey[] = [];
    const nested: StorageKey[] = [indirect];
    indirect.push(nested);

    expect(() => Key.from(sparse)).toThrow(new TypeError('Storage key is invalid'));
    expect(() => Key.from(undefinedItem)).toThrow(new TypeError('Storage key is invalid'));
    expect(() => Key.from(direct)).toThrow(new TypeError('Storage key is invalid'));
    expect(() => Key.from(indirect)).toThrow(new TypeError('Storage key is invalid'));
  });

  it('отклоняет detached binary buffer', () => {
    const buffer = new ArrayBuffer(1);

    structuredClone(buffer, {
      transfer: [buffer],
    });

    expect(() => Key.from(buffer)).toThrow(new TypeError('Storage key is invalid'));
  });

  it('допускает повторно использованный, но не cyclic nested array', () => {
    const shared: readonly StorageKey[] = ['shared'];

    expect(Key.from([shared, shared]).value).toEqual([['shared'], ['shared']]);
  });

  it('создаёт собственный snapshot mutable key components', () => {
    const date = new Date(100);
    const bytes = new Uint8Array([1, 2, 3]);
    const nested: StorageKey[] = [date, bytes, ['value']];
    const key = Key.from(nested);

    date.setTime(200);
    bytes[0] = 9;
    nested.push('late');
    (nested[2] as StorageKey[]).push('mutation');

    const value = key.value as readonly [Date, ArrayBuffer, readonly string[]];

    expect(value[0].getTime()).toBe(100);
    expect([...new Uint8Array(value[1])]).toEqual([1, 2, 3]);
    expect(value[2]).toEqual(['value']);
    expect(Object.isFrozen(key)).toBe(true);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('копирует только byte range переданного binary view', () => {
    const bytes = new Uint8Array([9, 1, 2, 9]);
    const view = new Uint8Array(bytes.buffer, 1, 2);
    const value = Key.from(view).value as ArrayBuffer;

    expect([...new Uint8Array(value)]).toEqual([1, 2]);
  });

  it('не раскрывает mutable snapshot через value', () => {
    const key = Key.from([new Date(100), new Uint8Array([1, 2, 3])]);
    const first = key.value as readonly [Date, ArrayBuffer];

    first[0].setTime(200);
    new Uint8Array(first[1])[0] = 9;

    const second = key.value as readonly [Date, ArrayBuffer];

    expect(second[0].getTime()).toBe(100);
    expect([...new Uint8Array(second[1])]).toEqual([1, 2, 3]);
    expect(first).not.toBe(second);
  });

  it('использует storage type ordering', () => {
    const ordered: readonly StorageKey[] = [0, new Date(0), '', new Uint8Array(), []];

    for (let index = 0; index < ordered.length - 1; index += 1) {
      expect(compare(ordered[index], ordered[index + 1])).toBe(-1);
      expect(compare(ordered[index + 1], ordered[index])).toBe(1);
    }
  });

  it('сравнивает values внутри каждого storage type', () => {
    expect(compare(Number.NEGATIVE_INFINITY, 0)).toBe(-1);
    expect(compare(-0, 0)).toBe(0);
    expect(compare(new Date(1), new Date(2))).toBe(-1);
    expect(compare('a', 'aa')).toBe(-1);
    expect(compare('aa', 'b')).toBe(-1);
    expect(compare(new Uint8Array([0, 255]), new Uint8Array([1, 0]))).toBe(-1);
    expect(compare(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(-1);
    expect(compare([1, 'b'], [1, 'c'])).toBe(-1);
    expect(compare([1], [1, 0])).toBe(-1);
    expect(compare([1, [2]], [1, [2]])).toBe(0);
  });

  it('совпадает с IDBFactory.cmp на representative matrix', () => {
    const factory = new IDBFactory();
    const keys: readonly StorageKey[] = [
      Number.NEGATIVE_INFINITY,
      -1,
      0,
      Number.POSITIVE_INFINITY,
      new Date(-1),
      new Date(0),
      '',
      'a',
      new Uint8Array([0]),
      [],
      [0],
      [0, 'a'],
      [[0]],
    ];

    for (const left of keys) {
      for (const right of keys) {
        expect(compare(left, right)).toBe(factory.cmp(left as IDBValidKey, right as IDBValidKey));
      }
    }
  });
});
