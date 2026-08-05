# `@library/orm`

Domain-neutral browser ORM with an internal IndexedDB driver.

The package solves persistence tasks for callers. IndexedDB handles, requests,
cursors and transactions do not cross its public boundary. The package does
not know application entities, repositories, Sync or Backend contracts.

## Minimal usage

```ts
class Message {
  readonly id!: string;
  chatId!: string;
  position!: number;
  text!: string;
}

const messages = table('messages')
  .entity(Message)
  .define({
    primaryKey: 'id',
    indexes: [{ keyPath: 'chatId' }, { keyPath: ['chatId', 'position'] }],
  });

const definition = schema({
  name: 'application',
  version: 1,
  tables: [messages],
});

await connection.open(definition);

await connection.insert(messages).values(message).execute();
await connection.upsert(messages).values(changedMessage).execute();

const messagesForChat = await connection
  .select(messages)
  .where(messages.field('chatId'), chatId)
  .orderBy(messages.field('position'), 'asc')
  .takeLast(20)
  .getMany();

await connection.update(messages).set({ text: 'Updated' }).where(messages.field('id'), messageId).execute();

await connection.delete(messages).where(messages.field('id'), messageId).execute();
```

`getMany()` and `getOne()` return entity instances for tables declared through
`.entity(Entity)`. `getRawMany()` and `getRawOne()` return stored records.
Tables declared through `.record<Record>()` return records from both terminal
families.

TypeScript interfaces disappear at runtime, so `.record<Record>()` does not
provide runtime validation. The ORM validates its own schema and operation
structure, but does not invent domain validation.

## Operations

- `select(table)` builds a read operation;
- `insert(table)` adds new records and fails on an existing key;
- `upsert(table)` inserts or replaces records;
- `update(table)` changes records selected by `where`;
- `delete(table)` removes records selected by `where`;
- `transaction(tables, callback)` executes operations atomically in a fixed
  table scope.

`update` and `delete` cannot execute before `where`. A record primary key cannot
be changed by `update`.

`limit(size)` returns the beginning of the declared order. `takeLast(size)`
returns its tail without changing that order. For example, `ASC + takeLast(20)`
returns the latest 20 records in ascending order, so repositories do not
reverse materialized results.

An operation that requires a full store scan is rejected by default. A caller
must opt in at the read terminal:

```ts
await connection.select(messages).getMany({ scan: 'allow' });
```

## Transactions

```ts
const result = await connection.transaction([messages, checkpoints], async (transaction) => {
  await transaction.upsert(messages).values(message).execute();
  await transaction.upsert(checkpoints).values(checkpoint).execute();

  return transaction.select(messages).where(messages.field('id'), message.id).getOne();
});
```

The callback may return any value. All operations use one native read-write
transaction. A rejected callback or failed operation rolls back the whole
scope. The transaction object is invalid after the callback completes.

## Boundaries

- `src/schema`, `src/expression`, `src/range`, `src/select` and `src/mutation`
  own ORM language;
- `src/planner` and `src/selection` are internal planning layers;
- `src/client` owns the public connection lifecycle;
- `src/transaction` owns scoped operation access;
- `src/driver/indexed-db` is the only browser storage implementation;
- `src/index.ts` is the only package facade.

The current design and exact semantics are documented in
[docs/orm-design.md](docs/orm-design.md). Implementation status is tracked in
[docs/orm-roadmap.md](docs/orm-roadmap.md).

## Verification

```bash
yarn tsc -p library/orm/tsconfig.json --noEmit
yarn test library/orm/src
```
