"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { saveMonitor, testMonitor, type ActionResult, type TestResult } from "@/app/app/actions";
import { buttonClass, cn, Field, FormError, Input, Select, Spinner } from "@/components/ui";
import { describeMonitor, type MonitorDraft } from "@/lib/monitor-input";
import { INTERVALS } from "@/lib/rules";
import { Segmented, useFormAction } from "./controls";

export function MonitorForm({ id, initial, locked }: { id?: string; initial: MonitorDraft; locked?: string }) {
  const [state, onSubmit, saving] = useFormAction<ActionResult>(saveMonitor);
  const [d, setD] = useState<MonitorDraft>(initial);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, startTest] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const set = <K extends keyof MonitorDraft>(k: K, v: MonitorDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setTest(null);
  };
  const fields = state && !state.ok ? state.fields : undefined;
  const disabled = !!locked;

  const runTest = () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    setTestError(null);
    startTest(async () => {
      const r = await testMonitor(data);
      if ("summary" in r) setTest(r);
      else if (!r.ok) {
        setTest(null);
        setTestError(r.fields?.url ?? r.error);
      }
    });
  };

  return (
    <form ref={form} onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <fieldset disabled={disabled} className="grid min-w-0 gap-8">
        <section className="grid gap-5">
          <h2 className="text-[17px] font-semibold">What to check</h2>
          <Field label="Address" error={fields?.url} hint="A page, an API endpoint or a health check URL. It has to be reachable from the internet.">
            <Input
              name="url"
              value={d.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="https://example.com"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              autoFocus={!id}
              aria-invalid={!!fields?.url}
              className="h-11 text-[15.5px]"
            />
          </Field>
          <Field label="Name" error={fields?.name} hint="Shown on the dashboard and in alerts. Leave it empty to use the address.">
            <Input name="name" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Online shop, checkout" maxLength={80} />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">How often</span>
            <Segmented
              name="intervalSec"
              value={d.intervalSec}
              onChange={(v) => set("intervalSec", v)}
              options={INTERVALS.map((i) => ({ value: i.sec, label: i.sec === 3600 ? "1 h" : `${i.sec / 60} min` }))}
              className="self-start"
              disabled={disabled}
            />
          </div>
        </section>

        <section className="grid gap-5 border-t border-rule pt-7">
          <div>
            <h2 className="text-[17px] font-semibold">When it counts as down</h2>
            <p className="mt-1 text-[13.5px] text-muted">The defaults suit most websites. Change them for APIs or slow pages.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Expected status codes" error={fields?.expectedStatus} hint="Like 200-399, 2xx or 200,204.">
              <Input name="expectedStatus" value={d.expectedStatus} onChange={(e) => set("expectedStatus", e.target.value)} spellCheck={false} aria-invalid={!!fields?.expectedStatus} />
            </Field>
            <div className="grid content-start gap-1.5">
              <span className="text-[13px] font-medium text-ink-2">Request</span>
              <Segmented
                name="method"
                value={d.method}
                onChange={(v) => set("method", v)}
                options={[
                  { value: "GET", label: "GET" },
                  { value: "HEAD", label: "HEAD" },
                ]}
                className="self-start"
                disabled={disabled}
              />
              <span className="text-[12.5px] leading-snug text-muted">HEAD skips the page body: lighter, but no keyword check.</span>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_200px]">
            <Field label="Keyword (optional)" error={fields?.keyword} hint="Catches pages that load but show an error, like an empty shop.">
              <Input name="keyword" value={d.keyword} onChange={(e) => set("keyword", e.target.value)} placeholder="Add to cart" aria-invalid={!!fields?.keyword} />
            </Field>
            <Field label="The page must">
              <Select name="keywordMode" value={d.keywordMode} onChange={(e) => set("keywordMode", e.target.value as MonitorDraft["keywordMode"])}>
                <option value="contains">contain it</option>
                <option value="absent">not contain it</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Timeout (seconds)" error={fields?.timeoutSec}>
              <Input name="timeoutSec" type="number" min={1} max={30} value={d.timeoutSec} onChange={(e) => set("timeoutSec", Number(e.target.value))} aria-invalid={!!fields?.timeoutSec} />
            </Field>
            <Field label="Slow above (ms)" error={fields?.slowMs}>
              <Input name="slowMs" type="number" min={100} max={30000} step={100} value={d.slowMs} onChange={(e) => set("slowMs", Number(e.target.value))} aria-invalid={!!fields?.slowMs} />
            </Field>
            <div className="grid content-start gap-1.5">
              <span className="text-[13px] font-medium text-ink-2">Failures before alerting</span>
              <Segmented
                name="confirmAfter"
                value={d.confirmAfter}
                onChange={(v) => set("confirmAfter", v)}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
                className="self-start"
                disabled={disabled}
              />
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-7">
          <button type="submit" className={buttonClass("primary", "md")} disabled={saving || disabled}>
            {saving ? <Spinner /> : null}
            {id ? "Save changes" : "Add monitor"}
          </button>
          <button type="button" onClick={runTest} className={buttonClass("outline", "md")} disabled={testing || disabled || !d.url.trim()}>
            {testing ? <Spinner /> : null}
            Test this address
          </button>
          <Link href={id ? `/app/monitors/${id}` : "/app"} className={buttonClass("ghost", "md")}>
            Cancel
          </Link>
        </div>
        <FormError>{state && !state.ok && !fields ? state.error : null}</FormError>
      </fieldset>

      <aside className="lg:sticky lg:top-[120px] lg:self-start">
        {locked ? <p className="mb-4 rounded-panel border border-rule bg-card p-4 text-[13.5px] leading-relaxed text-ink-2">{locked}</p> : null}
        <div className="rounded-panel border border-rule bg-card p-5">
          <h2 className="text-[13px] font-medium text-muted">What Nabd will do</h2>
          <div className="mt-3 grid gap-3 text-[14px] leading-relaxed text-ink-2">
            {describeMonitor(d).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
        <div aria-live="polite">
          {test ? (
            <div className={cn("mt-3 rounded-panel border p-4 text-[14px] leading-relaxed", test.ok ? "border-up/25 bg-up-soft text-up" : "border-down/25 bg-down-soft text-down")}>
              <p className="font-medium">{test.ok ? test.summary : `Failed: ${test.summary}`}</p>
              {test.detail ? <p className="mt-0.5 opacity-85">{test.detail}</p> : null}
            </div>
          ) : testError ? (
            <p className="mt-3 rounded-panel border border-down/25 bg-down-soft p-4 text-[14px] text-down">{testError}</p>
          ) : null}
        </div>
      </aside>
    </form>
  );
}
