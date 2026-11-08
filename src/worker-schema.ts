// This module deliberately does not import config, the pool, LINE, or OpenAI.
// It is also used by the read-only release preflight command.
export const REQUIRED_WORKER_MIGRATION =
  "010_consultation_processing_holds.sql";

type SchemaDatabase = {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
};

const REQUIRED_COLUMNS = {
  schema_migrations: { filename: "text" },
  consultations: {
    first_send_attempt_at: "timestamptz",
    delivery_channel: "text",
  },
  web_identities: { web_user_id: "uuid", canonical_user_id: "text" },
  web_notices: { consultation_id: "uuid", kind: "text" },
  consultation_processing_holds: {
    consultation_id: "uuid",
    reason: "text",
    held_at: "timestamptz",
  },
  consultation_intake_sessions: {
    line_user_id: "text",
    stage: "text",
    turns: "jsonb",
    step: "int4",
    draft_consultation_id: "uuid",
    expires_at: "timestamptz",
    updated_at: "timestamptz",
  },
} as const;

export class WorkerSchemaError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(
      `Worker schema is incompatible: ${problems.join("; ")}. ` +
        "Review the release migration plan before starting the worker. " +
        "No migrations were applied by this check.",
    );
    this.name = "WorkerSchemaError";
  }
}

/** Metadata-only check: never repairs schemas or touches consultation data. */
export async function assertWorkerSchema(db: SchemaDatabase): Promise<void> {
  const result = await db.query(`
    SELECT table_name, column_name, udt_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('schema_migrations', 'consultation_intake_sessions', 'consultations', 'consultation_processing_holds','web_identities','web_notices')
  `);
  const columns = new Map(
    result.rows.map((row) => [
      `${row.table_name}.${row.column_name}`,
      row.udt_name,
    ]),
  );
  const problems: string[] = [];
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    for (const [column, type] of Object.entries(required)) {
      const actual = columns.get(`${table}.${column}`);
      if (actual === undefined) {
        problems.push(`missing public.${table}.${column}`);
      } else if (actual !== type) {
        problems.push(`unexpected type for public.${table}.${column}`);
      }
    }
  }
  if (problems.length) throw new WorkerSchemaError(problems);

  const migration = await db.query(`
    SELECT filename FROM public.schema_migrations
     WHERE filename IN ('009_consultation_intake_sessions.sql','${REQUIRED_WORKER_MIGRATION}')
  `);
  if (migration.rows.length !== 2) {
    throw new WorkerSchemaError([
      `migrations 009 and ${REQUIRED_WORKER_MIGRATION} must both be recorded`,
    ]);
  }
}
