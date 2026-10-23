"use client";

import { useState } from "react";
import { addChannel, deleteChannel, setChannelActive, testChannel, type ActionResult } from "@/app/app/actions";
import { buttonClass, Field, FormError, Notice, Input, Spinner } from "@/components/ui";
import { ConfirmButton, Note, Segmented, Switch, useFormAction, useRunner } from "./controls";

type Kind = "email" | "slack" | "discord" | "webhook";

const TARGET: Record<Kind, { label: string; placeholder: string; hint: string }> = {
  email: { label: "Email address", placeholder: "oncall@example.com", hint: "Down, recovery and certificate alerts arrive as plain email." },
  slack: { label: "Slack incoming-webhook URL", placeholder: "https://hooks.slack.com/services/…", hint: "In Slack: Apps, Incoming Webhooks, Add to a channel. Paste the URL it gives you." },
  discord: { label: "Discord webhook URL", placeholder: "https://discord.com/api/webhooks/…", hint: "In Discord: channel settings, Integrations, Webhooks, New webhook, Copy URL." },
  webhook: { label: "Your endpoint", placeholder: "https://example.com/hooks/nabd", hint: "Nabd POSTs JSON, signed with this channel's secret (shown after you add it)." },
};

export function AddChannel({ disabledReason }: { disabledReason?: string }) {
  const [kind, setKind] = useState<Kind>("slack");
  const [state, onSubmit, pending] = useFormAction<ActionResult>(addChannel, (r, el) => {
    if (r.ok) el.reset();
  });
  const fields = state && !state.ok ? state.fields : undefined;
  const t = TARGET[kind];
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <fieldset disabled={!!disabledReason} className="grid min-w-0 gap-4">
        <Segmented
          name="kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "slack", label: "Slack" },
            { value: "discord", label: "Discord" },
            { value: "email", label: "Email" },
            { value: "webhook", label: "Webhook" },
          ]}
          className="flex-wrap self-start"
          disabled={!!disabledReason}
        />
        <Field label={t.label} error={fields?.target} hint={t.hint}>
          <Input name="target" key={kind} type={kind === "email" ? "email" : "url"} placeholder={t.placeholder} spellCheck={false} aria-invalid={!!fields?.target} />
        </Field>
        <Field label="Name (optional)" error={fields?.name}>
          <Input name="name" placeholder={kind === "email" ? "On-call" : "#incidents"} maxLength={60} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass("primary", "md")} disabled={pending}>
            {pending ? <Spinner /> : null}
            Add channel
          </button>
          {state?.ok ? <span className="text-[13.5px] text-up">{state.message}</span> : null}
        </div>
      </fieldset>
      {disabledReason ? <Notice>{disabledReason}</Notice> : <FormError>{state && !state.ok && !fields ? state.error : null}</FormError>}
    </form>
  );
}

export function ChannelControls({ id, active, locked }: { id: string; active: boolean; locked: boolean }) {
  const test = useRunner();
  const toggle = useRunner();
  const [on, setOn] = useState(active);
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <Note note={test.note ?? toggle.note} />
      <button type="button" className={buttonClass("outline", "sm")} disabled={test.pending || !on} onClick={() => test.run(() => testChannel(id))}>
        {test.pending ? <Spinner /> : null}
        Send test
      </button>
      {!locked ? (
        <>
          <Switch
            checked={on}
            label={on ? "Turn this channel off" : "Turn this channel on"}
            disabled={toggle.pending}
            onChange={(v) => {
              setOn(v);
              toggle.run(async () => {
                const r = await setChannelActive(id, v);
                if (!r.ok) setOn(!v);
                return r;
              });
            }}
          />
          <ConfirmButton confirmLabel="Delete" onConfirm={() => deleteChannel(id)}>
            Remove
          </ConfirmButton>
        </>
      ) : null}
    </div>
  );
}

export function SecretReveal({ secret }: { secret: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <code className="rounded-[3px] bg-well px-1.5 py-0.5 text-[12.5px]">{shown ? secret : `${secret.slice(0, 6)}${"•".repeat(12)}`}</code>
      <button type="button" onClick={() => setShown((s) => !s)} className="text-[12.5px] font-medium text-ink-2 hover:text-ink">
        {shown ? "Hide" : "Show"}
      </button>
    </span>
  );
}
