import { matches } from '../../../expression/index.ts';
import type { QueryOperation } from '../../../error/index.ts';
import type { StorageKey } from '../../../key/index.ts';
import type { Plan } from '../../../planner/index.ts';
import { Range } from '../../../range/index.ts';
import type { SchemaTable, TableRecord } from '../../../schema/index.ts';
import { NativeConnection } from '../connection/index.ts';
import { mapQueryError } from '../error/index.ts';
import { compile } from '../range/index.ts';
import { compileIndex } from '../schema/index.ts';
import type { Transaction } from '../transaction/index.ts';

import { candidate, deduplicate, intersect } from './candidate.ts';
import type { Candidate } from './candidate.ts';

type RangePlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'primary' | 'index' }>;
type BranchPlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'primary' | 'index' | 'union' }>;
type IntersectionPlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'intersection' }>;
type SourcePlan<TableType extends SchemaTable> = BranchPlan<TableType> | IntersectionPlan<TableType>;
type ScanPlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'scan' }>;
type OrderedPlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'ordered' }>;

type CompiledRange<TableType extends SchemaTable> = Readonly<{
  plan: RangePlan<TableType>;
  range: IDBKeyRange;
  continueWhile?: Range;
}>;

type PreparedBranch<TableType extends SchemaTable> = Readonly<{
  plan: BranchPlan<TableType>;
  ranges: readonly CompiledRange<TableType>[];
}>;

type PreparedSource<TableType extends SchemaTable> =
  | Readonly<{
      type: 'branch';
      source: BranchPlan<TableType>;
      branches: readonly [PreparedBranch<TableType>];
    }>
  | Readonly<{
      type: 'intersection';
      source: IntersectionPlan<TableType>;
      branches: readonly [PreparedBranch<TableType>, PreparedBranch<TableType>, ...PreparedBranch<TableType>[]];
    }>;

export class Executor {
  public constructor(
    private readonly connection: NativeConnection | undefined,
    private readonly keyRange: typeof IDBKeyRange,
  ) {}

  public static scoped(keyRange: typeof IDBKeyRange): Executor {
    return new Executor(undefined, keyRange);
  }

  public execute<TableType extends SchemaTable>(
    plan: Plan<TableType>,
    operation: QueryOperation = 'select.getRawMany',
  ): Promise<TableRecord<TableType>[]> {
    if (plan.type === 'empty' || plan.limit === 0 || plan.takeLast === 0) {
      return Promise.resolve([]);
    }

    if (plan.type === 'scan') {
      return this.mapErrors(operation, () => this.executeScan(plan)).then((candidates) =>
        this.recordsOf(this.applyWindow(plan, candidates)),
      );
    }

    if (plan.type === 'ordered') {
      return this.mapErrors(operation, () => this.executeOrdered(plan)).then((candidates) =>
        this.recordsOf(this.applyWindow(plan, candidates)),
      );
    }

    const source = plan.type === 'post-filter' ? plan.source : plan;
    let prepared: PreparedSource<TableType>;

    try {
      prepared = this.prepareSource(source);
    } catch (cause) {
      return Promise.reject(cause instanceof TypeError ? cause : mapQueryError(operation, cause));
    }

    if (prepared.branches.some((branch) => branch.ranges.length === 0)) {
      return Promise.resolve([]);
    }

    return this.mapErrors(operation, async () => {
      const candidates = await this.executeSource(prepared);

      return plan.type === 'post-filter' ? candidates.filter(({ record }) => matches(plan.filter, record)) : candidates;
    }).then((candidates) => this.recordsOf(this.applyWindow(plan, candidates)));
  }

  public executeIn<TableType extends SchemaTable>(
    plan: Plan<TableType>,
    transaction: Transaction<TableType['name']>,
  ): Promise<Candidate<TableRecord<TableType>>[]> {
    if (plan.type === 'empty' || plan.limit === 0 || plan.takeLast === 0) {
      return Promise.resolve([]);
    }

    if (plan.type === 'scan') {
      return this.read<TableRecord<TableType>, TableType['name']>(
        transaction,
        plan.table.name,
        (store) => store.openCursor(),
        (record) => plan.filter === undefined || matches(plan.filter, record),
        undefined,
        plan.takeLast === undefined ? plan.limit : undefined,
      ).then((candidates) => this.applyWindow(plan, candidates));
    }

    if (plan.type === 'ordered') {
      return this.executeOrderedIn(plan, transaction).then((candidates) => this.applyWindow(plan, candidates));
    }

    let prepared: PreparedSource<TableType>;

    try {
      prepared = this.prepareSource(plan.type === 'post-filter' ? plan.source : plan);
    } catch (cause) {
      return Promise.reject(cause);
    }

    if (prepared.branches.some((branch) => branch.ranges.length === 0)) {
      return Promise.resolve([]);
    }

    return this.executeSourceIn(prepared, transaction).then((candidates) =>
      this.applyWindow(
        plan,
        plan.type === 'post-filter' ? candidates.filter(({ record }) => matches(plan.filter, record)) : candidates,
      ),
    );
  }

  private prepareSource<TableType extends SchemaTable>(source: SourcePlan<TableType>): PreparedSource<TableType> {
    if (source.type === 'intersection') {
      const [first, second, ...rest] = source.plans;

      return {
        type: 'intersection',
        source,
        branches: [
          this.prepareBranch(first),
          this.prepareBranch(second),
          ...rest.map((branch) => this.prepareBranch(branch)),
        ],
      };
    }

    return {
      type: 'branch',
      source,
      branches: [this.prepareBranch(source)],
    };
  }

  private prepareBranch<TableType extends SchemaTable>(plan: BranchPlan<TableType>): PreparedBranch<TableType> {
    const ranges: CompiledRange<TableType>[] = [];

    const collect = (branch: BranchPlan<TableType>): void => {
      if (branch.type === 'union') {
        branch.plans.forEach(collect);

        return;
      }

      const compilation = compile(branch.range, this.keyRange);

      if (compilation.type === 'range') {
        ranges.push({
          plan: branch,
          range: compilation.value,
          ...(compilation.continueWhile === undefined
            ? {}
            : {
                continueWhile: compilation.continueWhile,
              }),
        });
      }
    };

    collect(plan);

    return {
      plan,
      ranges,
    };
  }

  private executeSource<TableType extends SchemaTable>(
    prepared: PreparedSource<TableType>,
  ): Promise<Candidate<TableRecord<TableType>>[]> {
    const transaction = this.requireConnection().transaction([prepared.source.table.name], 'readonly');

    return transaction.run((scope) => this.executeSourceIn(prepared, scope));
  }

  private async executeSourceIn<TableType extends SchemaTable>(
    prepared: PreparedSource<TableType>,
    transaction: Transaction<TableType['name']>,
  ): Promise<Candidate<TableRecord<TableType>>[]> {
    const operations = prepared.branches.map((branch) =>
      this.executeBranch<TableType>(transaction, prepared.source.table.name, branch),
    );
    const branches = await Promise.all(operations);

    return prepared.type === 'intersection'
      ? intersect([branches[0], branches[1], ...branches.slice(2)])
      : branches[0];
  }

  private executeBranch<TableType extends SchemaTable>(
    transaction: Transaction<TableType['name']>,
    storeName: TableType['name'],
    branch: PreparedBranch<TableType>,
  ): Promise<Candidate<TableRecord<TableType>>[]> {
    const operations = branch.ranges.map(({ plan, range, continueWhile }) =>
      this.read<TableRecord<TableType>, TableType['name']>(
        transaction,
        storeName,
        (store) =>
          plan.type === 'primary'
            ? store.openCursor(range)
            : store.index(compileIndex(plan.index).name).openCursor(range),
        () => true,
        continueWhile,
      ),
    );

    return Promise.all(operations).then((ranges) => (branch.plan.type === 'union' ? deduplicate(ranges) : ranges[0]));
  }

  private executeScan<TableType extends SchemaTable>(
    plan: ScanPlan<TableType>,
  ): Promise<Candidate<TableRecord<TableType>>[]> {
    const transaction = this.requireConnection().transaction([plan.table.name], 'readonly');

    return transaction.run((scope) =>
      this.read<TableRecord<TableType>, TableType['name']>(
        scope,
        plan.table.name,
        (store) => store.openCursor(),
        (record) => plan.filter === undefined || matches(plan.filter, record),
        undefined,
        plan.takeLast === undefined ? plan.limit : undefined,
      ),
    );
  }

  private executeOrdered<TableType extends SchemaTable>(
    plan: OrderedPlan<TableType>,
  ): Promise<Candidate<TableRecord<TableType>>[]> {
    const transaction = this.requireConnection().transaction([plan.table.name], 'readonly');

    return transaction.run((scope) => this.executeOrderedIn(plan, scope));
  }

  private executeOrderedIn<TableType extends SchemaTable>(
    plan: OrderedPlan<TableType>,
    transaction: Transaction<TableType['name']>,
  ): Promise<Candidate<TableRecord<TableType>>[]> {
    const compilation = plan.range === undefined ? undefined : compile(plan.range, this.keyRange);

    if (compilation?.type === 'empty') {
      return Promise.resolve([]);
    }

    const range = compilation?.value;
    const requestedDirection: IDBCursorDirection = plan.direction === 'asc' ? 'next' : 'prev';
    const tailDirection: IDBCursorDirection = requestedDirection === 'next' ? 'prev' : 'next';
    const preferredDirection = plan.takeLast === undefined ? requestedDirection : tailDirection;
    const cannotStartFromEnd = preferredDirection === 'prev' && compilation?.continueWhile !== undefined;
    const direction: IDBCursorDirection = cannotStartFromEnd ? 'next' : preferredDirection;
    const reverse = direction !== requestedDirection;
    const earlyLimit =
      direction === requestedDirection
        ? plan.takeLast === undefined
          ? plan.limit
          : undefined
        : plan.takeLast;

    return this.read<TableRecord<TableType>, TableType['name']>(
      transaction,
      plan.table.name,
      (store) =>
        plan.access.type === 'primary'
          ? store.openCursor(range, direction)
          : store.index(compileIndex(plan.access.index).name).openCursor(range, direction),
      (record) => plan.filter === undefined || matches(plan.filter, record),
      compilation?.type === 'range' ? compilation.continueWhile : undefined,
      earlyLimit,
    ).then((records) => (reverse ? records.reverse() : records));
  }

  private read<RecordType, Name extends string>(
    transaction: Transaction<Name>,
    storeName: Name,
    open: (store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null>,
    include: (record: RecordType) => boolean,
    continueWhile?: Range,
    limit?: number,
  ): Promise<Candidate<RecordType>[]> {
    const candidates: Candidate<RecordType>[] = [];

    try {
      return transaction
        .store(storeName)
        .iterate<RecordType>(open, (entry) => {
          if (continueWhile !== undefined && !continueWhile.includes(entry.key as StorageKey)) {
            return 'stop';
          }

          const value = candidate(entry.record, entry.primaryKey);

          if (include(value.record)) {
            candidates.push(value);

            if (limit !== undefined && candidates.length >= limit) {
              return 'stop';
            }
          }

          return 'continue';
        })
        .then(() => candidates);
    } catch (cause) {
      return Promise.reject(cause);
    }
  }

  private readonly recordsOf = <RecordType>(candidates: readonly Candidate<RecordType>[]): RecordType[] =>
    candidates.map(({ record }) => record);

  private applyWindow<TableType extends SchemaTable, RecordType>(
    plan: Plan<TableType>,
    candidates: Candidate<RecordType>[],
  ): Candidate<RecordType>[] {
    if (plan.limit !== undefined) {
      return candidates.slice(0, plan.limit);
    }

    return plan.takeLast === undefined ? candidates : candidates.slice(-plan.takeLast);
  }

  private mapErrors<Result>(operation: QueryOperation, execute: () => Promise<Result>): Promise<Result> {
    try {
      return execute().catch((cause: unknown) => {
        throw mapQueryError(operation, cause);
      });
    } catch (cause) {
      return Promise.reject(mapQueryError(operation, cause));
    }
  }

  private requireConnection(): NativeConnection {
    if (this.connection === undefined) {
      throw new TypeError('Standalone selection executor requires a connection');
    }

    return this.connection;
  }
}
