"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { DEMO } from "@/db/seed";
import { createAccount, EmailTakenError, verifyLogin } from "@/server/accounts";
import { createSession, destroySession } from "@/server/auth";

export type FormState = { error?: string; fields?: Record<string, string>; values?: Record<string, string> } | null;

const safeNext = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/app") ? s : "/app";
};

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", values: { email } };
  const session = await verifyLogin(await getDb(), email, password);
  if (!session) return { error: "That email and password don't match an account.", values: { email } };
  await createSession(session);
  redirect(safeNext(form.get("next")));
}

export async function demoLogin(form: FormData) {
  const session = await verifyLogin(await getDb(), DEMO.email, DEMO.password);
  if (!session) redirect("/login?demo=missing");
  await createSession(session);
  redirect(safeNext(form.get("next")));
}

const Signup = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.email("Enter a valid email.").max(120),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
  workspaceName: z.string().trim().min(2, "Name your workspace, like your company.").max(80),
  timezone: z.string().max(60).default("UTC"),
});

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const raw = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const parsed = Signup.safeParse(raw);
  const values = { ...raw, password: "" };
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>;
    return { fields: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? "Check this field."])), values };
  }
  let tz = parsed.data.timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  try {
    const acct = await createAccount(await getDb(), { ...parsed.data, timezone: tz });
    await createSession(acct);
  } catch (e) {
    if (e instanceof EmailTakenError) return { fields: { email: "There's already an account with this email. Sign in instead." }, values };
    throw e;
  }
  redirect("/app?welcome=1");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
