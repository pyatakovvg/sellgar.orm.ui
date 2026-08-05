export {
  createDelete,
  createInsert,
  createUpdate,
  createUpsert,
  Delete,
  DeleteExecution,
  Insert,
  Update,
  UpdateExecution,
  UpdateWhere,
  Upsert,
  Write,
} from './mutation.ts';
export type {
  InsertArguments,
  InsertManyInput,
  InsertRecord,
  UpdateValues,
  UpsertArguments,
  UpsertManyInput,
  UpsertRecord,
  WriteEntry,
} from './mutation.ts';
export { normalizeWrite } from './normalization.ts';
export type { NormalizedWrite } from './normalization.ts';
