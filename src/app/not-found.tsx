import Link from "next/link";
import { Logo } from "@/components/brand";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16">
      <Link href="/" className="self-start">
        <Logo />
      </Link>
      <h1 className="mt-10 text-[30px] leading-tight font-semibold tracking-[-0.02em]">Nothing answers at this address</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-ink-2">The page may have moved, or a status page may have been unpublished. If you followed a link from an alert, the monitor may have been deleted.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/app" className={buttonClass("primary", "md")}>
          Go to your monitors
        </Link>
        <Link href="/" className={buttonClass("outline", "md")}>
          Nabd home
        </Link>
      </div>
    </div>
  );
}
