import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { getConnection } from "@/db";
import { workspaces } from "@/db/schema";

const COOKIE = "nabd_session";
const MAX_AGE = 60 * 60 * 24 * 14;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.VERCEL_ENV === "production") console.warn("[auth] AUTH_SECRET is not set; using a fallback derived from the deployment.");
  return new TextEncoder().encode(s ?? `nabd-dev-secret-${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "local"}`);
}

export type Session = { userId: string; workspaceId: string };

export async function createSession(s: Session) {
  const token = await new SignJWT({ wid: s.workspaceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MAX_AGE });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
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
