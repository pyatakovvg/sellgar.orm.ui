import { candidate, deduplicate, intersect } from '../candidate.ts';
import type { Candidate } from '../candidate.ts';

interface RecordValue {
  readonly id: string;
}

describe('IndexedDB Plan Candidate', () => {
  it('сохраняет record identity и immutable scalar primary key', () => {
    const record: RecordValue = {
      id: 'record-1',
    };
    const value = candidate(record, 'record-1');

    expectTypeOf(value).toEqualTypeOf<Candidate<RecordValue>>();
    expect(value.record).toBe(record);
    expect(value.primaryKey.value).toBe('record-1');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.primaryKey)).toBe(true);
  });

  it('snapshot-ит Date, binary и compound primary keys', () => {
    const date = new Date(100);
    const bytes = new Uint8Array([1, 2, 3]);
    const compound: IDBValidKey[] = [date, bytes, ['nested']];
    const value = candidate(
      {
        id: 'record-1',
      },
      compound,
    );

    date.setTime(200);
    bytes[0] = 9;
    compound.push('late');
    (compound[2] as IDBValidKey[]).push('mutation');

    const primaryKey = value.primaryKey.value as readonly [Date, ArrayBuffer, readonly string[]];

    expect(primaryKey[0].getTime()).toBe(100);
    expect([...new Uint8Array(primaryKey[1])]).toEqual([1, 2, 3]);
    expect(primaryKey[2]).toEqual(['nested']);
  });

  it('не добавляет caching в Candidate factory', () => {
    const record: RecordValue = {
      id: 'record-1',
    };
    const first = candidate(record, 'record-1');
    const second = candidate(record, 'record-1');

    expect(first).not.toBe(second);
    expect(first.primaryKey).not.toBe(second.primaryKey);
    expect(first.primaryKey.compare(second.primaryKey)).toBe(0);
  });

  it('deduplicate-ит scalar primary keys без mutation branch arrays', () => {
    const first = candidate({ id: 'first' }, 'record-2');
    const duplicate = candidate({ id: 'duplicate' }, 'record-2');
    const distinct = candidate({ id: 'distinct' }, 'record-1');
    const firstBranch = [first, distinct] as const;
    const secondBranch = [duplicate] as const;
    const result = deduplicate([firstBranch, secondBranch]);

    expect(result).toHaveLength(2);
    expect(result.map((value) => value.primaryKey.value)).toEqual(['record-1', 'record-2']);
    expect(firstBranch).toEqual([first, distinct]);
    expect(secondBranch).toEqual([duplicate]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(duplicate)).toBe(true);
  });

  it('использует storage equality для Date, binary и compound primary keys', () => {
    const cases: readonly [IDBValidKey, IDBValidKey][] = [
      [new Date(100), new Date(100)],
      [new Uint8Array([1, 2]), new Uint8Array([1, 2])],
      [
        ['tenant', new Date(100), new Uint8Array([1, 2])],
        ['tenant', new Date(100), new Uint8Array([1, 2])],
      ],
    ];

    for (const [left, right] of cases) {
      const result = deduplicate([[candidate({ id: 'left' }, left)], [candidate({ id: 'right' }, right)]]);

      expect(result).toHaveLength(1);
    }
  });

  it('не deduplicate-ит разные primary keys по одинаковому record content', () => {
    const result = deduplicate([[candidate({ id: 'same' }, 'record-1')], [candidate({ id: 'same' }, 'record-2')]]);

    expect(result).toHaveLength(2);
  });

  it('пересекает normalized branches по primary key и сохраняет survivor первой branch', () => {
    const survivor = candidate({ id: 'first-record-1' }, 'record-1');
    const distinct = candidate({ id: 'first-record-2' }, 'record-2');
    const duplicate = candidate({ id: 'second-record-1' }, 'record-1');
    const second = [candidate({ id: 'second-record-3' }, 'record-3'), duplicate, duplicate] as const;
    const first = [distinct, survivor] as const;
    const third = [candidate({ id: 'third-record-1' }, 'record-1')] as const;
    const result = intersect([first, second, third]);

    expect(result).toEqual([survivor]);
    expect(result[0]).toBe(survivor);
    expect(first).toEqual([distinct, survivor]);
    expect(second).toEqual([second[0], duplicate, duplicate]);
    expect(third).toEqual([third[0]]);
  });

  it('использует storage equality для Date, binary и compound intersection keys', () => {
    const cases: readonly [IDBValidKey, IDBValidKey][] = [
      [new Date(100), new Date(100)],
      [new Uint8Array([1, 2]), new Uint8Array([1, 2])],
      [
        ['tenant', new Date(100), new Uint8Array([1, 2])],
        ['tenant', new Date(100), new Uint8Array([1, 2])],
      ],
    ];

    for (const [left, right] of cases) {
      const survivor = candidate({ id: 'left' }, left);
      const result = intersect([[survivor], [candidate({ id: 'right' }, right)]]);

      expect(result).toEqual([survivor]);
    }
  });

  it('не пересекает одинаковый record content с разными primary keys', () => {
    const result = intersect([[candidate({ id: 'same' }, 'record-1')], [candidate({ id: 'same' }, 'record-2')]]);

    expect(result).toEqual([]);
  });

  it('возвращает новый empty array при empty branch', () => {
    const first = intersect([[candidate({ id: 'record-1' }, 'record-1')], []]);
    const second = intersect([[candidate({ id: 'record-1' }, 'record-1')], []]);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(first).not.toBe(second);
  });
});
