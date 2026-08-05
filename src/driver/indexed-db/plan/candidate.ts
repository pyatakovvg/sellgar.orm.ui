import { Key } from '../../../key/index.ts';
import type { StorageKey } from '../../../key/index.ts';

export type Candidate<RecordType> = Readonly<{
  record: RecordType;
  primaryKey: Key;
}>;

export const candidate = <RecordType>(record: RecordType, primaryKey: IDBValidKey): Candidate<RecordType> =>
  Object.freeze({
    record,
    primaryKey: Key.from(primaryKey as StorageKey),
  });

export const deduplicate = <RecordType>(
  branches: readonly (readonly Candidate<RecordType>[])[],
): Candidate<RecordType>[] => {
  const values = branches.flat();

  values.sort((left, right) => left.primaryKey.compare(right.primaryKey));

  return values.filter((value, index) => index === 0 || values[index - 1].primaryKey.compare(value.primaryKey) !== 0);
};

const find = <RecordType>(
  values: readonly Candidate<RecordType>[],
  primaryKey: Candidate<RecordType>['primaryKey'],
): Candidate<RecordType> | undefined => {
  let lower = 0;
  let upper = values.length - 1;

  while (lower <= upper) {
    const index = Math.floor((lower + upper) / 2);
    const value = values[index];
    const comparison = value.primaryKey.compare(primaryKey);

    if (comparison === 0) {
      return value;
    }

    if (comparison < 0) {
      lower = index + 1;
    } else {
      upper = index - 1;
    }
  }

  return undefined;
};

export const intersect = <RecordType>(
  branches: readonly [
    readonly Candidate<RecordType>[],
    readonly Candidate<RecordType>[],
    ...(readonly Candidate<RecordType>[])[],
  ],
): Candidate<RecordType>[] => {
  const normalized = branches.map((branch) => deduplicate([branch]));

  if (normalized.some((branch) => branch.length === 0)) {
    return [];
  }

  let anchor = normalized[0];

  for (const branch of normalized.slice(1)) {
    if (branch.length < anchor.length) {
      anchor = branch;
    }
  }

  const result: Candidate<RecordType>[] = [];

  for (const candidate of anchor) {
    let survivor: Candidate<RecordType> | undefined;

    for (let index = 0; index < normalized.length; index += 1) {
      const match = find(normalized[index], candidate.primaryKey);

      if (match === undefined) {
        survivor = undefined;
        break;
      }

      if (index === 0) {
        survivor = match;
      }
    }

    if (survivor !== undefined) {
      result.push(survivor);
    }
  }

  return result;
};
