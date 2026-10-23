import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { getConnection } from "@/db";
import { workspaces } from "@/db/schema";
import { appKey } from "./keys";

const COOKIE = "nabd_session";
const MAX_AGE = 60 * 60 * 24 * 14;

const key = async () => new TextEncoder().encode(await appKey("session"));

export type Session = { userId: string; workspaceId: string };

export async function createSession(s: Session) {
  const token = await new SignJWT({ wid: s.workspaceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(await key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MAX_AGE });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const k = await key();
  try {
    const { payload } = await jwtVerify(token, k, { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.wid !== "string") return null;
    return { userId: payload.sub, workspaceId: payload.wid };
  } catch {
    return null;
  }
}

/** For app pages and actions: the signed-in owner's workspace, or /login. */
export async function requireWorkspace() {
  const session = await readSession();
  if (!session) redirect("/login");
  const conn = await getConnection();
  const [workspace] = await conn.db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).limit(1);
  if (!workspace || workspace.ownerId !== session.userId) redirect("/login");
  return { conn, db: conn.db, workspace, session };
}

export const SESSION_COOKIE = COOKIE;
