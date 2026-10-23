import "server-only";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { channels, users, workspaces } from "@/db/schema";
import { newId, newSecret } from "@/lib/id";

let dummy: string | undefined;
const dummyHash = () => (dummy ??= bcrypt.hashSync("not-a-real-password", 10));

export async function verifyLogin(db: DB, email: string, password: string) {
  const [user] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase())).limit(1);
  // Compare against a dummy hash when the user is missing so timing doesn't leak which emails exist.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? dummyHash());
  if (!user || !ok) return null;
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, user.id)).limit(1);
  return ws ? { userId: user.id, workspaceId: ws.id } : null;
}

export class EmailTakenError extends Error {}

/** A new account starts with a workspace and an email channel to its owner, so the first outage already reaches someone. */
export async function createAccount(db: DB, input: { name: string; email: string; password: string; workspaceName: string; timezone: string }) {
  const email = input.email.trim().toLowerCase();
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
  if (taken) throw new EmailTakenError();
  const userId = newId("usr");
  const workspaceId = newId("ws");
  await db.insert(users).values({ id: userId, email, name: input.name.trim(), passwordHash: await bcrypt.hash(input.password, 10) });
  await db.insert(workspaces).values({ id: workspaceId, ownerId: userId, name: input.workspaceName.trim(), timezone: input.timezone });
  await db.insert(channels).values({ id: newId("ch"), workspaceId, kind: "email", name: "My email", target: email, secret: newSecret() });
  return { userId, workspaceId };
}
