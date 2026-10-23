import "server-only";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";
import { databaseUrl, ensureMigrated, type MigrationTarget } from "./migrate";

export { databaseUrl };

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The Drizzle handle plus the raw client underneath it (for raw SQL helpers). */
export type Connection = { db: DB; raw: MigrationTarget };

type GlobalConn = { __nabdConn?: Promise<Connection> };
const g = globalThis as unknown as GlobalConn;

async function connect(): Promise<Connection> {
  const url = databaseUrl();
  if (url) {
    // prepare:false keeps us compatible with transaction-mode poolers
    // (Neon's -pooler host, Supabase on :6543).
    const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20 });
    const db = drizzlePg(client, { schema }) as unknown as DB;
    // Drizzle hands date values to postgres.js as strings, so it swaps the
    // driver's date serializers for pass-throughs. A Date that reaches the
    // driver directly (a sql`` fragment, a raw query) would then crash it;
    // PGlite accepts both, which is why only production would notice.
    const serializers = client.options.serializers as Record<number, (v: unknown) => unknown>;
    for (const oid of [1082, 1114, 1184]) {
      const pass = serializers[oid];
      serializers[oid] = (v) => (v instanceof Date ? v.toISOString() : pass ? pass(v) : v);
    }
    // Schema changes run once per deploy, in the build step (scripts/migrate.ts).
    return { db, raw: { kind: "postgres", client } };
  }
  // No Postgres configured: an embedded Postgres (PGlite). Locally it lives in
  // .data/; on Vercel (before a database is connected) it lives in /tmp.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? (process.env.VERCEL ? "/tmp/nabd-pglite" : ".data/pglite");
  if (process.env.VERCEL) console.warn("[db] No DATABASE_URL: using a temporary embedded database. Connect Postgres for persistence.");
  (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const client = await PGlite.create(dir);
  const raw: MigrationTarget = { kind: "pglite", client };
  await ensureMigrated(raw);
  return { db: drizzlePglite(client, { schema }) as unknown as DB, raw };
}

export function getConnection(): Promise<Connection> {
  if (!g.__nabdConn) {
    g.__nabdConn = connect().catch((err) => {
      g.__nabdConn = undefined;
      throw err;
    });
  }
  return g.__nabdConn;
}

export async function getDb(): Promise<DB> {
  return (await getConnection()).db;
}

export { schema };
