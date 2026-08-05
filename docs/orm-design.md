# Browser ORM design

- Status: normative first-version contract.
- Implementation status: [orm-roadmap.md](orm-roadmap.md).
- Package entry point: [`../README.md`](../README.md).

## Purpose

The ORM gives application code a typed persistence language while keeping the
storage engine replaceable and invisible.

```text
application database owner
        ↓
ClientInterface<Schema>
        ↓
operation builders
        ↓
selection and planner
        ↓
IndexedDB driver
```

The application owns concrete schemas and database lifecycle services. This
package owns generic persistence semantics. The driver owns physical browser
storage.

The library is not a proxy over IndexedDB and is not a wrapper around Dexie.
Its public concepts are records, entities, tables, fields, expressions,
operations and transactions.

## Schema

Schema construction is staged so TypeScript can bind a record before checking
keys and indexes:

```ts
const records = table('records')
  .record<RecordValue>()
  .define({
    primaryKey: 'id',
    indexes: [{ keyPath: 'status' }],
  });
```

For runtime models:

```ts
const messages = table('messages')
  .entity(MessageEntity)
  .define({
    primaryKey: 'id',
    indexes: [{ keyPath: ['chatId', 'position', 'id'] }],
  });
```

Supported key strategies:

- assigned key stored in the record;
- auto-increment numeric key stored in the record;
- assigned external key;
- auto-increment external key;
- simple and compound key paths;
- unique and multi-entry secondary indexes where IndexedDB supports them.

The schema compiler is the only layer that converts ORM schema values into
IndexedDB store and index definitions.

Interfaces provide compile-time structure only. They do not exist at runtime.
The ORM therefore does not claim runtime validation for
`.record<RecordValue>()`.

## Models and raw records

`getRawOne` and `getRawMany` return the stored record representation.

For `.entity(Entity)` tables, `getOne` and `getMany` create an entity with its
zero-argument constructor and assign the stored fields. This preserves methods
and runtime identity without requiring a mapper in every repository.

Materialization does not run `class-transformer` or `class-validator`. Those
libraries are not part of the generic database contract.

## Read operation

```ts
const result = await connection
  .select(messages)
  .where(messages.field('chatId'), chatId)
  .where(oneOf(messages.field('status'), ['pending', 'sending']))
  .orderBy(messages.field('position'), 'asc')
  .orderBy(messages.field('id'), 'asc')
  .takeLast(20)
  .getMany();
```

`where(field, value)` is shorthand for `where(eq(field, value))`. Multiple
`where` calls are combined with logical `and`.

Read terminals:

- `getRawMany`;
- `getRawOne`;
- `getMany`;
- `getOne`.

`getOne` returns the first record in the declared order or `undefined`.

Ordering is expressed by repeated `orderBy(field, direction)`. The planner
matches the full ordered field sequence against a primary key or index,
including an equality-constrained compound prefix.

`limit(size)` selects the beginning of the declared order. `takeLast(size)`
selects its tail and preserves the declared order. Calling either operation
replaces the previous window operation. Both reject negative and non-integer
sizes.

For compound ordering, a one-sided predicate on the first ordered field narrows
the physical prefix range. This allows previous-page reads to use one bounded
cursor instead of repeatedly reading records by identity.

## Expressions and ranges

Public expressions are immutable typed values:

- `eq`;
- `gt`, `gte`, `lt`, `lte`;
- `between`;
- `oneOf`;
- `isNull`, `isMissing`;
- `and`, `or`, `not`.

The planner uses indexes when semantics match. Residual predicates are applied
as post-filters. A logically valid operation that cannot be served without a
store scan is rejected unless the read terminal receives
`{ scan: 'allow' }`.

Scan permission belongs to one execution. It is not stored in a table,
expression or builder.

## Insert and upsert

```ts
await connection.insert(messages).values(message).execute();
await connection.insert(messages).values([first, second]).execute();

await connection.upsert(messages).values(message).execute();
await connection.upsert(messages).values([first, second]).execute();
```

`insert` fails when the key already exists. `upsert` inserts or replaces the
record.

For a record key, callers pass records directly. An assigned external key uses
`values(record, key)` for one record and `[record, key]` entries for bulk
storage. The unusual tuple exists only where the key is not part of the record.

## Update

```ts
const affected = await connection
  .update(messages)
  .set({ status: 'delivered' })
  .where(messages.field('id'), messageId)
  .execute();
```

Update is a filtered set-based operation and returns the number of affected
records. It cannot execute without `where`.

A record primary key cannot be part of `.set`. This is enforced by TypeScript
and at runtime. Changing identity is delete plus insert, not update.

The first version uses shallow partial assignment. Nested patch semantics are
not implied.

## Delete

```ts
const affected = await connection
  .delete(messages)
  .where(oneOf(messages.field('status'), ['pending', 'sending']))
  .execute();
```

Delete is a filtered set-based operation, returns the number of affected
records and cannot execute without `where`. Full-store deletion is not an
accidental empty predicate; if required later it needs an explicit operation.

## Client lifecycle

`ClientInterface<Schema>` is the stable connection boundary:

```ts
abstract class ClientInterface<SchemaType extends Schema> {
  open(schema: SchemaType): Promise<void>;
  select(table): Select;
  insert(table): Insert;
  upsert(table): Upsert;
  update(table): Update;
  delete(table): Delete;
  transaction(tables, callback): Promise<Result>;
  close(): void;
}
```

A client instance binds to one exact schema descriptor. It may be opened
idempotently with that descriptor. `close` is terminal. Operations reject or
throw stable lifecycle errors before reaching the driver.

The domain-specific database service may expose this typed connection. It must
not mirror every operation with forwarding methods.

## Transactions

```ts
const value = await connection.transaction(
  [messages, checkpoints],
  async (transaction) => {
    await transaction.upsert(messages).values(message).execute();
    await transaction.upsert(checkpoints).values(checkpoint).execute();

    return transaction
      .select(messages)
      .where(messages.field('id'), message.id)
      .getOne();
  },
);
```

Rules:

- scope is a non-empty tuple of exact tables from the client schema;
- every operation uses the same native read-write transaction;
- the callback may perform any number of operations and return any value;
- a callback rejection aborts the transaction and preserves application error
  identity;
- a request failure aborts and rolls back all writes;
- the transaction API becomes inactive after callback completion;
- physical connection and transaction objects never escape.

## Internal planning

Public builders contain no driver handles. They create an immutable internal
selection. At a terminal:

1. the client verifies lifecycle and exact table membership;
2. the planner selects primary/index/union/intersection/scan and post-filter
   work;
3. the IndexedDB executor opens or reuses the required transaction;
4. the executor returns stored records;
5. the select terminal optionally materializes entities.

Update and delete reuse the same planner, then mutate candidates inside one
read-write transaction. An ordered selection is currently a read concern and
is not accepted as a mutation source.

## Errors

Stable public error families:

- `ClientError` — availability, open lifecycle and schema membership;
- `QueryError` — scan requirement, unsupported ordering and read/planning
  failures;
- `MutationError` — constraints, keys, cloning, quota and write failures;
- `TransactionError` — scope, activity, start, commit and abort failures;
- `SchemaValidationError` and `ConfigurationError`;
- `UnsupportedOperationError`.

Physical error messages are not public contracts. Native errors remain
available only through `cause`. An existing logical ORM error is never wrapped
again as a generic physical error.

## Public facade

The package facade exposes:

- `ClientInterface` and its DI bindings;
- `schema`, `table`, `externalKey` and schema types needed by consumers;
- `Select`, `Insert`, `Upsert`, `Update`, `Delete`;
- expression and range constructors;
- stable error classes and codes.

It does not expose:

- internal selection or plan;
- executors, writers and normalization;
- IndexedDB schema compiler, requests, stores, cursors or transactions;
- intermediate fluent-state classes;
- compatibility names for removed APIs.

## Deferred work

The following are not silently implied by the current API:

- projections and aggregates;
- pagination/limit/offset/cursor semantics;
- joins and relations;
- nested partial updates;
- migrations and legacy formats;
- cross-tab broadcasting or worker coordination;
- reactive query subscriptions.

They are introduced only from concrete application needs and must preserve the
boundaries above.
