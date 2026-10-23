import Link from "next/link";
import { Logo } from "@/components/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="self-start">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center py-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20">
        <p className="max-w-md text-[34px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance">Hear it from Nabd, not from a customer.</p>
        <p className="mt-4 max-w-md text-[16px] leading-relaxed text-white/60">
          Every check, every incident and every alert in one place, with a status page your customers can read in English or Arabic.
        </p>
        <ol className="mt-12 max-w-md border-s border-white/15 ps-6 text-[14px] leading-relaxed">
          {[
            ["03:12", "A check gets HTTP 503 from the shop."],
            ["03:17", "The next check fails too. Incident opened, on-call alerted."],
            ["03:18", "The status page shows a partial outage."],
            ["03:31", "Checks pass again. Incident resolved after 19 min."],
          ].map(([t, s], i) => (
            <li key={t} className="relative pb-5 last:pb-0">
              <span className={`absolute -start-[29px] top-1.5 size-2.5 rounded-full ${i === 3 ? "bg-up" : i === 0 ? "bg-white/40" : "bg-down"}`} aria-hidden />
              <span className="readout me-3 text-white/45">{t}</span>
              <span className="text-white/80">{s}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[12px] text-white/35">An example of how an outage plays out.</p>
      </aside>
    </div>
  );
}
