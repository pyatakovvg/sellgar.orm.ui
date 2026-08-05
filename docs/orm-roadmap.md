# Browser ORM roadmap

- Status: active implementation tracker.
- Normative semantics: [orm-design.md](orm-design.md).
- Rule: completed stages are marked here; obsolete implementation history is
  deleted rather than accumulated.

## Current point

The first usable ORM vertical is implemented and integrated into Chat
repositories. The public API is operation-oriented:

```text
select · insert · upsert · update · delete · transaction
```

No parallel or compatibility API is maintained.

## Stages

| Stage | Scope                                                         | Status    |
| ----- | ------------------------------------------------------------- | --------- |
| 1     | Table, fields, primary keys and indexes                       | completed |
| 2     | Schema validation and IndexedDB schema compiler               | completed |
| 3     | Typed expressions and ranges                                  | completed |
| 4     | Immutable selection and query planner                         | completed |
| 5     | IndexedDB connection, requests and cursor execution           | completed |
| 6     | `select` with ordering and raw terminals                      | completed |
| 7     | Entity materialization through model terminals                | completed |
| 8     | `insert` and `upsert`, including bulk writes                  | completed |
| 9     | Filtered `update` and `delete`                                | completed |
| 10    | Scoped atomic transactions with arbitrary callback result     | completed |
| 11    | Stable error mapping and lifecycle precedence                 | completed |
| 12    | Minimal package facade and removal of old API                 | completed |
| 13    | Chat database connection and repository integration           | completed |
| 14    | Pagination semantics from Chat and Message consumer use cases | completed |
| 15    | Chat list projection with the latest Message                  | completed |
| 16    | Performance review against real Chat and Sync workloads       | pending   |

## Completed vertical acceptance

- a schema describes runtime storage without migrations;
- records can use assigned, generated, record and external keys;
- indexed reads and compatible compound ordering are typed;
- explicit scan permission is required for non-indexed reads;
- entity terminals return runtime entity instances;
- raw terminals return stored records;
- `insert` rejects duplicate keys;
- `upsert` replaces existing records;
- bulk writes accept arrays of records for record-key tables;
- `update` and `delete` require `where` and return affected counts;
- record primary keys cannot be updated;
- one transaction can read and write multiple declared tables;
- callback failure rolls the entire transaction back;
- application errors retain identity;
- IndexedDB objects do not appear in public contracts;
- Chat repositories contain no manual hydration or in-memory sorting for their
  declared ordered queries;
- `limit` selects the beginning and `takeLast` selects the tail without changing
  the declared result order;
- previous Chat and Message pages use bounded batch reads rather than an
  awaited identity lookup per record;
- the concrete Chat database service exposes one typed connection instead of
  proxying every ORM method.

## Next stage

Stage 16 begins only after the Sync workloads and their Local DB access
patterns are approved. The ORM must not invent Sync contracts.

## Verification at every completed stage

```bash
yarn tsc -p library/orm/tsconfig.json --noEmit
yarn test library/orm/src
yarn tsc -p library/domain/tsconfig.json --noEmit
yarn test library/domain/src
yarn build:ai_analytics_assistant_ui
git diff --check
```
