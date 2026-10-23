import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em]">Create your workspace</h1>
      <p className="mt-2 text-[15px] text-muted">
        Already have one?{" "}
        <Link href="/login" className="font-medium text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
      <SignupForm />
    </>
  );
}
