# `library/orm`

This package is a domain-neutral browser ORM. Before changing it, read:

1. [README.md](README.md);
2. [docs/orm-design.md](docs/orm-design.md);
3. [docs/orm-roadmap.md](docs/orm-roadmap.md);
4. the current code and tests of the selected owner.

## Non-negotiable boundaries

- IndexedDB is an internal driver, not the public programming model.
- Do not add Dexie or another storage abstraction beneath the ORM.
- Do not add domain tables, entities, repositories, Sync or transport logic.
- Do not expose `IDBDatabase`, `IDBTransaction`, `IDBRequest`, cursors or
  `IDBKeyRange`.
- Do not add compatibility aliases or a parallel public API.
- This is the first version: no migrations, legacy formats or parallel APIs.
- Public operations are `select`, `insert`, `upsert`, `update`, `delete` and
  `transaction`.
- `update` and `delete` require an explicit `where`.
- `insert` and `upsert` remain different operations.
- Entity materialization belongs to the ORM; domain validation belongs to the
  entity/application owner.

## Change protocol

1. Identify the owner of the semantic change.
2. Update the smallest public contract needed.
3. Keep planning and IndexedDB execution behind internal facades.
4. Add compile-time tests for fluent typing.
5. Add fake IndexedDB tests for observable behavior and transaction atomicity.
6. Rewrite obsolete documentation; do not append change history.
7. Mark the stage in `docs/orm-roadmap.md`.

External implementations such as
[dexbee-js](https://github.com/AhamSammich/dexbee-js) may be used as design
references. Copying their driver vocabulary or public restrictions without
checking this ORM's semantics is prohibited.

## Public facade

`src/index.ts` exports only developer-facing construction, operations,
expressions and stable errors. Internal selection, plan, executor, writer,
normalization and driver types remain internal.

Avoid exporting intermediate fluent states merely because public methods return
them. TypeScript can preserve the chain without turning implementation parts
into named package exports.

## Verification

```bash
yarn tsc -p library/orm/tsconfig.json --noEmit
yarn test library/orm/src
yarn build:ai_analytics_assistant_ui
git diff --check
```
