export type Mode = 'readonly' | 'readwrite';

export type Scope<Name extends string> = readonly [Name, ...Name[]];

export type CursorEntry<RecordType> = Readonly<{
  record: RecordType;
  key: IDBValidKey;
  primaryKey: IDBValidKey;
}>;

export type CursorAction = 'continue' | 'stop';

type State = 'active' | 'complete' | 'aborted';

interface Fulfilled<Result> {
  readonly status: 'fulfilled';
  readonly value: Result;
}

interface Rejected {
  readonly status: 'rejected';
  readonly reason: unknown;
}

type Outcome<Result> = Fulfilled<Result> | Rejected;

const createAbortError = (): DOMException =>
  new DOMException('IndexedDB transaction aborted without a physical error', 'AbortError');

const createRequestError = (): Error => new Error('IndexedDB request failed without a physical error');

const createInactiveError = (): Error => new Error('IndexedDB transaction is no longer active');

const createUnknownStoreError = (name: string): Error =>
  new Error(`Store "${name}" is not part of the IndexedDB transaction scope`);

const getEventError = (event: Event): unknown => {
  const target = event.target;

  if (target === null || !('error' in target)) {
    return undefined;
  }

  return target.error;
};

const reflect = <Result>(promise: Promise<Result>): Promise<Outcome<Result>> =>
  promise.then(
    (value): Fulfilled<Result> => ({
      status: 'fulfilled',
      value,
    }),
    (reason: unknown): Rejected => ({
      status: 'rejected',
      reason,
    }),
  );

class Store<Name extends string> {
  public constructor(
    private readonly transaction: Transaction<Name>,
    private readonly store: IDBObjectStore,
  ) {}

  public request<Result>(create: (store: IDBObjectStore) => IDBRequest<Result>): Promise<Result>;
  public request<NativeResult, Result>(
    create: (store: IDBObjectStore) => IDBRequest<NativeResult>,
    transform: (result: NativeResult) => Result,
  ): Promise<Result>;
  public request<NativeResult, Result = NativeResult>(
    create: (store: IDBObjectStore) => IDBRequest<NativeResult>,
    transform?: (result: NativeResult) => Result,
  ): Promise<Result> {
    this.transaction.assertActive();

    let request: IDBRequest<NativeResult>;

    try {
      request = create(this.store);
    } catch (error) {
      this.transaction.abort(error);
      throw error;
    }

    const operation = new Promise<Result>((resolve, reject) => {
      const cleanup = (): void => {
        request.removeEventListener('success', handleSuccess);
        request.removeEventListener('error', handleError);
      };

      const handleSuccess = (): void => {
        cleanup();

        try {
          resolve(transform === undefined ? (request.result as unknown as Result) : transform(request.result));
        } catch (error) {
          this.transaction.abort(error);
          reject(error);
        }
      };

      const handleError = (): void => {
        const cause = request.error ?? createRequestError();

        this.transaction.captureRequestCause(cause);
        cleanup();
        reject(cause);
      };

      request.addEventListener('success', handleSuccess);
      request.addEventListener('error', handleError);
    });

    // Scheduling следующего request может синхронно завершиться ошибкой и
    // оставить уже созданный request без consumer Promise-chain.
    void operation.catch(() => undefined);

    return operation;
  }

  public iterate<RecordType>(
    open: (store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null>,
    visit: (entry: CursorEntry<RecordType>) => CursorAction,
  ): Promise<void> {
    this.transaction.assertActive();

    let request: IDBRequest<IDBCursorWithValue | null>;

    try {
      request = open(this.store);
    } catch (error) {
      this.transaction.abort(error);
      throw error;
    }

    const operation = new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        request.removeEventListener('success', handleSuccess);
        request.removeEventListener('error', handleError);
      };

      const handleSuccess = (): void => {
        try {
          const cursor = request.result;

          if (cursor === null) {
            cleanup();
            resolve();

            return;
          }

          const action = visit(
            Object.freeze({
              record: cursor.value as RecordType,
              key: cursor.key,
              primaryKey: cursor.primaryKey,
            }),
          );

          if (action === 'stop') {
            cleanup();
            resolve();

            return;
          }

          cursor.continue();
        } catch (error) {
          cleanup();
          this.transaction.abort(error);
          reject(error);
        }
      };

      const handleError = (): void => {
        const cause = request.error ?? createRequestError();

        this.transaction.captureRequestCause(cause);
        cleanup();
        reject(cause);
      };

      request.addEventListener('success', handleSuccess);
      request.addEventListener('error', handleError);
    });

    void operation.catch(() => undefined);

    return operation;
  }
}

export class Transaction<Name extends string> {
  private state: State = 'active';
  private readonly names: ReadonlySet<string>;
  public readonly completion: Promise<void>;
  private resolveCompletion: (() => void) | undefined;
  private rejectCompletion: ((cause: unknown) => void) | undefined;
  private requestCause: unknown;
  private schedulingCause: unknown;
  private hasRequestCause = false;
  private hasSchedulingCause = false;

  public constructor(
    private readonly transaction: IDBTransaction,
    scope: Scope<Name>,
  ) {
    this.names = new Set(scope);
    this.completion = new Promise((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });

    this.transaction.addEventListener('complete', this.handleComplete);
    this.transaction.addEventListener('abort', this.handleAbort);
    this.transaction.addEventListener('error', this.handleError);
  }

  public get active(): boolean {
    return this.state === 'active';
  }

  public get mode(): Mode {
    return this.transaction.mode as Mode;
  }

  public store<StoreName extends Name>(name: StoreName): Store<Name> {
    this.assertActive();

    if (!this.names.has(name)) {
      throw createUnknownStoreError(name);
    }

    return new Store(this, this.transaction.objectStore(name));
  }

  public run<Result>(schedule: (transaction: Transaction<Name>) => Promise<Result>): Promise<Result> {
    let result: Promise<Result>;

    try {
      result = schedule(this);
    } catch (error) {
      this.abort(error);
      result = Promise.reject(error);
    }

    const operation = reflect(result);

    return this.completion.then(
      async () => {
        const outcome = await operation;

        if (outcome.status === 'rejected') {
          throw outcome.reason;
        }

        return outcome.value;
      },
      (cause: unknown) => {
        throw cause;
      },
    );
  }

  public abort(cause: unknown): void {
    if (!this.active) {
      return;
    }

    if (!this.hasSchedulingCause) {
      this.hasSchedulingCause = true;
      this.schedulingCause = cause;
    }

    try {
      this.transaction.abort();
    } catch {
      this.finish('aborted', cause);
    }
  }

  public assertActive(): void {
    if (!this.active) {
      throw createInactiveError();
    }
  }

  public captureRequestCause(cause: unknown): void {
    if (this.hasRequestCause) {
      return;
    }

    this.hasRequestCause = true;
    this.requestCause = cause;
  }

  private readonly handleComplete = (): void => {
    this.finish('complete');
  };

  private readonly handleAbort = (): void => {
    const cause = this.hasSchedulingCause
      ? this.schedulingCause
      : this.hasRequestCause
        ? this.requestCause
        : (this.transaction.error ?? createAbortError());

    this.finish('aborted', cause);
  };

  private readonly handleError = (event: Event): void => {
    if (this.hasRequestCause) {
      return;
    }

    const cause = getEventError(event);

    if (cause !== undefined && cause !== null) {
      this.captureRequestCause(cause);
    }
  };

  private finish(state: Exclude<State, 'active'>, cause?: unknown): void {
    if (!this.active) {
      return;
    }

    this.state = state;
    this.transaction.removeEventListener('complete', this.handleComplete);
    this.transaction.removeEventListener('abort', this.handleAbort);
    this.transaction.removeEventListener('error', this.handleError);

    if (state === 'complete') {
      this.resolveCompletion?.();
    } else {
      this.rejectCompletion?.(cause);
    }

    this.resolveCompletion = undefined;
    this.rejectCompletion = undefined;
  }
}
