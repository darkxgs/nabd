import type { MigrationTarget } from "./migrate";

export async function rawExec(target: MigrationTarget, sqlText: string) {
  if (target.kind === "postgres") await target.client.unsafe(sqlText);
  else await target.client.exec(sqlText);
}

export async function rawQuery<T>(target: MigrationTarget, sqlText: string, params: unknown[] = []) {
  if (target.kind === "postgres") {
    return (await target.client.unsafe(sqlText, params as never[])) as unknown as T[];
  }
  return (await target.client.query<T>(sqlText, params)).rows;
}
