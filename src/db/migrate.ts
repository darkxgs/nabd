// Tiny SQL-file migrator shared by the app, the CLI script and the tests.
// It works with both postgres-js (production) and PGlite (local + tests).
import type { Sql } from "postgres";
import type { PGlite } from "@electric-sql/pglite";
import { rawExec as exec, rawQuery as query } from "./raw";
import { migrations } from "./migrations";
import { seedDemo } from "./seed";

export type MigrationTarget = { kind: "postgres"; client: Sql } | { kind: "pglite"; client: PGlite };

// libpq and Prisma options that postgres.js would otherwise send to the server
// as startup parameters ("unrecognized configuration parameter").
const CLIENT_ONLY_PARAMS = ["channel_binding", "pgbouncer", "schema", "connection_limit", "pool_timeout"];

/** Removes connection-string options postgres.js doesn't understand. */
export function cleanPgUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of CLIENT_ONLY_PARAMS) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

/** The pooled connection string (Neon, Supabase and Vercel Postgres names). */
export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  return url ? cleanPgUrl(url) : undefined;
}

/** A direct (non-pooled) connection for migrations, falling back to the pooled one. */
export function directDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  return url ? cleanPgUrl(url) : databaseUrl();
}

let migrated: Promise<void> | undefined;

export function ensureMigrated(target: MigrationTarget): Promise<void> {
  if (!migrated) migrated = runMigrations(target);
  return migrated;
}

export async function runMigrations(target: MigrationTarget, opts: { seed?: boolean; now?: Date } = {}) {
  await exec(target, `CREATE SCHEMA IF NOT EXISTS nabd`);
  await exec(target, `CREATE TABLE IF NOT EXISTS nabd._migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await query<{ name: string }>(target, `SELECT name FROM nabd._migrations`)).map((r) => r.name));
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await exec(target, `BEGIN;\n${m.sql}\nINSERT INTO nabd._migrations(name) VALUES ('${m.name}');\nCOMMIT;`);
  }
  if (opts.seed !== false && process.env.NABD_SEED_DEMO !== "0") {
    await seedDemo(target, opts.now);
  }
}
