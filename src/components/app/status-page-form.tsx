"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { deleteStatusPage, saveStatusPage, type ActionResult } from "@/app/app/actions";
import { buttonClass, cn, Field, FormError, Input, Spinner, Textarea } from "@/components/ui";
import { displayUrl } from "@/lib/monitor-input";
import { ConfirmButton, Segmented, Switch, useFormAction } from "./controls";

type Comp = { monitorId: string; label: string; labelAr: string };
type Page = { id: string; title: string; titleAr: string | null; slug: string; intro: string | null; introAr: string | null; defaultLocale: "en" | "ar"; published: boolean };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function StatusPageForm({
  page,
  monitors,
  links,
  origin,
  locked,
}: {
  page: Page | null;
  monitors: { id: string; name: string; url: string }[];
  links: Comp[];
  origin: string;
  locked?: string;
}) {
  const [state, onSubmit, saving] = useFormAction<ActionResult>(saveStatusPage);
  const [title, setTitle] = useState(page?.title ?? "");
  const [slug, setSlug] = useState(page?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!page);
  const [locale, setLocale] = useState<"en" | "ar">(page?.defaultLocale ?? "en");
  const [published, setPublished] = useState(page?.published ?? true);
  const [comps, setComps] = useState<Comp[]>(page ? links : monitors.map((m) => ({ monitorId: m.id, label: "", labelAr: "" })));
  const fields = state && !state.ok ? state.fields : undefined;
  const disabled = !!locked;
  const byId = new Map(monitors.map((m) => [m.id, m]));
  const included = new Set(comps.map((c) => c.monitorId));
  const rest = monitors.filter((m) => !included.has(m.id));

  const move = (i: number, d: -1 | 1) =>
    setComps((cs) => {
      const j = i + d;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const patch = (i: number, p: Partial<Comp>) => setComps((cs) => cs.map((c, k) => (k === i ? { ...c, ...p } : c)));

  return (
    <form onSubmit={onSubmit} className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
      {page ? <input type="hidden" name="id" value={page.id} /> : null}
      <input type="hidden" name="components" value={JSON.stringify(comps)} />
      <input type="hidden" name="defaultLocale" value={locale} />
      {published ? <input type="hidden" name="published" value="on" /> : null}

      <fieldset disabled={disabled} className="grid min-w-0 gap-9">
        <section className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Title" error={fields?.title}>
              <Input
                name="title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="Acme status"
                aria-invalid={!!fields?.title}
              />
            </Field>
            <Field label="العنوان بالعربية" error={fields?.titleAr}>
              <Input name="titleAr" defaultValue={page?.titleAr ?? ""} dir="rtl" lang="ar" className="font-arabic" />
            </Field>
          </div>
          <Field label="Address" error={fields?.slug} hint="Lowercase letters, numbers and dashes.">
            <div className="flex items-stretch overflow-hidden rounded-control border border-rule bg-card focus-within:border-ink">
              <span className="flex items-center border-e border-rule bg-well px-3 text-[14px] text-muted">{origin.replace(/^https?:\/\//, "")}/s/</span>
              <input
                name="slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                spellCheck={false}
                aria-invalid={!!fields?.slug}
                className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[14.5px] focus:outline-none"
              />
            </div>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Introduction (optional)" error={fields?.intro}>
              <Textarea name="intro" defaultValue={page?.intro ?? ""} maxLength={400} placeholder="Live status of our website, app and API." className="min-h-20" />
            </Field>
            <Field label="المقدمة بالعربية" error={fields?.introAr}>
              <Textarea name="introAr" defaultValue={page?.introAr ?? ""} maxLength={400} dir="rtl" lang="ar" className="font-arabic min-h-20" />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium text-ink-2">Opens in</span>
              <Segmented
                name="_locale"
                value={locale}
                onChange={setLocale}
                options={[
                  { value: "en", label: "English" },
                  { value: "ar", label: <span className="font-arabic">العربية</span> },
                ]}
                disabled={disabled}
              />
            </div>
            <label className="flex items-center gap-3 text-[14px]">
              <Switch checked={published} onChange={setPublished} label="Published" disabled={disabled} />
              {published ? "Published: anyone with the link can see it" : "Draft: only you can preview it"}
            </label>
          </div>
        </section>

        <section className="border-t border-rule pt-7">
          <h2 className="text-[17px] font-semibold">Components</h2>
          <p className="mt-1 text-[13.5px] text-muted">The monitors this page shows, in this order. Give them names your customers understand, in both languages.</p>
          <ul className="mt-4 grid gap-2">
            {comps.map((c, i) => {
              const m = byId.get(c.monitorId);
              if (!m) return null;
              return (
                <li key={c.monitorId} className="rounded-panel border border-rule bg-card p-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => setComps((cs) => cs.filter((x) => x.monitorId !== c.monitorId))}
                      aria-label={`Show ${m.name}`}
                      className="size-4 accent-ink"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{m.name}</span>
                      <span className="block truncate text-[12.5px] text-muted">{displayUrl(m.url)}</span>
                    </span>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="grid size-8 place-items-center rounded-control text-muted hover:bg-rule-2 hover:text-ink disabled:opacity-30" aria-label="Move up">
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === comps.length - 1}
                      className="grid size-8 place-items-center rounded-control text-muted hover:bg-rule-2 hover:text-ink disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ArrowDown className="size-4" />
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 ps-7 sm:grid-cols-2">
                    <Input value={c.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder={m.name} aria-label="Name on the page" className="h-9 text-[14px]" />
                    <Input value={c.labelAr} onChange={(e) => patch(i, { labelAr: e.target.value })} placeholder="الاسم بالعربية" dir="rtl" lang="ar" aria-label="Arabic name" className="font-arabic h-9 text-[14px]" />
                  </div>
                </li>
              );
            })}
          </ul>
          {rest.length ? (
            <div className="mt-5">
              <p className="text-[13px] font-medium text-muted">Not on this page</p>
              <ul className="mt-2 grid gap-1">
                {rest.map((m) => (
                  <li key={m.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-[14px] hover:bg-rule-2">
                      <input type="checkbox" checked={false} onChange={() => setComps((cs) => [...cs, { monitorId: m.id, label: "", labelAr: "" }])} className="size-4 accent-ink" />
                      <span className="truncate">{m.name}</span>
                      <span className="truncate text-[12.5px] text-muted">{displayUrl(m.url)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!monitors.length ? <p className="mt-4 text-[14px] text-muted">Add monitors first; then choose which ones this page shows.</p> : null}
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-7">
          <button type="submit" className={buttonClass("primary", "md")} disabled={saving || disabled}>
            {saving ? <Spinner /> : null}
            {page ? "Save changes" : "Create status page"}
          </button>
          {state?.ok ? <span className="text-[13.5px] text-up">{state.message}</span> : null}
        </div>
        <FormError>{state && !state.ok && !fields ? state.error : null}</FormError>
      </fieldset>

      <aside className="grid content-start gap-4 lg:sticky lg:top-[120px] lg:self-start">
        {locked ? <p className="rounded-panel border border-rule bg-card p-4 text-[13.5px] leading-relaxed text-ink-2">{locked}</p> : null}
        {page ? (
          <div className="rounded-panel border border-rule bg-card p-5">
            <h2 className="text-[13px] font-medium text-muted">Share it</h2>
            <a href={`/s/${page.slug}`} target="_blank" rel="noreferrer" className={cn(buttonClass("outline", "sm"), "mt-3 w-full")}>
              Open the status page
            </a>
            <Snippet label="Link" value={`${origin}/s/${page.slug}`} />
            <Snippet label="Badge for a README" value={`![Status](${origin}/s/${page.slug}/badge.svg)`} />
            <Snippet label="JSON for your own app" value={`${origin}/s/${page.slug}/status.json`} />
          </div>
        ) : (
          <div className="rounded-panel border border-rule bg-card p-5 text-[13.5px] leading-relaxed text-ink-2">
            A status page shows each component&apos;s current state, 90 days of uptime and recent incidents, in English and Arabic. Visitors switch languages with one tap.
          </div>
        )}
        {page && !locked ? (
          <div className="rounded-panel border border-rule bg-card p-5">
            <h2 className="text-[13px] font-medium text-muted">Delete</h2>
            <p className="mt-1 mb-3 text-[13.5px] text-ink-2">The address stops working. Monitors and incidents stay.</p>
            <ConfirmButton confirmLabel="Delete the page" onConfirm={() => deleteStatusPage(page.id)}>
              Delete status page
            </ConfirmButton>
          </div>
        ) : null}
      </aside>
    </form>
  );
}

function Snippet({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-muted">{label}</span>
        <button
          type="button"
          className="text-[12.5px] font-medium text-ink-2 hover:text-ink"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="mt-1 block truncate rounded-control bg-well px-2.5 py-2 text-[12.5px] text-ink-2" title={value}>
        {value}
      </code>
    </div>
  );
}
