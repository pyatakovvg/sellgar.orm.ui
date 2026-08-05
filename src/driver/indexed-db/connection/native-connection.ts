import { Transaction } from '../transaction';
import type { Mode, Scope } from '../transaction';

const createEmptyScopeError = (): Error => new Error('IndexedDB transaction scope must not be empty');

export class NativeConnection {
  private closedValue = false;

  public constructor(private readonly database: IDBDatabase) {
    this.database.addEventListener('versionchange', this.handleVersionChange);
    this.database.addEventListener('close', this.handleNativeClose);
  }

  public get closed(): boolean {
    return this.closedValue;
  }

  public close(): void {
    if (this.closedValue) {
      return;
    }

    this.markClosed();
    this.database.close();
  }

  public transaction<const Name extends string>(scope: Scope<Name>, mode: Mode): Transaction<Name> {
    if (scope.length === 0) {
      throw createEmptyScopeError();
    }

    const names = [...scope] as [Name, ...Name[]];
    const transaction = this.database.transaction(names, mode);

    return new Transaction(transaction, names);
  }

  private readonly handleVersionChange = (): void => {
    this.close();
  };

  private readonly handleNativeClose = (): void => {
    this.markClosed();
  };

  private markClosed(): void {
    this.closedValue = true;
    this.database.removeEventListener('versionchange', this.handleVersionChange);
    this.database.removeEventListener('close', this.handleNativeClose);
  }
}
