import "server-only";
import { randomBytes } from "node:crypto";
import { getConnection } from "@/db";
import type { MigrationTarget } from "@/db/migrate";
import { rawQuery } from "@/db/raw";

// The key Nabd signs session cookies with. AUTH_SECRET wins when it's set.
// Without it, the first request makes a random key and keeps it in the
// database, where every server instance finds the same one. A fresh deployment
// is safe before anyone sets a secret, and nothing guessable, like a URL or a
// project id, ever signs a cookie.

export type KeyName = "session";

const ENV: Record<KeyName, string> = { session: "AUTH_SECRET" };
const loaded = new Map<KeyName, Promise<string>>();

export function appKey(name: KeyName): Promise<string> {
  const env = process.env[ENV[name]];
  if (env && env.length >= 16) return Promise.resolve(env);
  let key = loaded.get(name);
  if (!key) {
    if (env) console.warn(`[keys] ${ENV[name]} is shorter than 16 characters; using the key kept in the database.`);
    key = getConnection()
      .then(({ raw }) => storedKey(raw, name))
      .catch((err) => {
        loaded.delete(name);
        throw err;
      });
    loaded.set(name, key);
  }
  return key;
}

/** The key kept in the database under `name`, made on first use. */
export async function storedKey(raw: MigrationTarget, name: KeyName): Promise<string> {
  // Two statements, not one: the select needs a snapshot taken after a racing
  // instance's insert has committed, so both instances read the same key.
  await rawQuery(raw, `INSERT INTO nabd.app_keys (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`, [
    name,
    randomBytes(32).toString("base64url"),
  ]);
  const [row] = await rawQuery<{ value: string }>(raw, `SELECT value FROM nabd.app_keys WHERE name = $1`, [name]);
  if (!row) throw new Error(`The ${name} key is missing`);
  return row.value;
}
