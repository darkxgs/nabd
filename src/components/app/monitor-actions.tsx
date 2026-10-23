"use client";

import { checkNow, deleteMonitor, setPaused } from "@/app/app/actions";
import { buttonClass, Spinner } from "@/components/ui";
import { ConfirmButton, Note, useRunner } from "./controls";

export function MonitorActions({ id, paused, locked }: { id: string; paused: boolean; locked: boolean }) {
  const check = useRunner();
  const pause = useRunner();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Note note={check.note ?? pause.note} className="me-1" />
      <button type="button" className={buttonClass("outline", "sm")} disabled={check.pending || paused} onClick={() => check.run(() => checkNow(id))}>
        {check.pending ? <Spinner /> : null}
        Check now
      </button>
      {!locked ? (
        <button type="button" className={buttonClass("outline", "sm")} disabled={pause.pending} onClick={() => pause.run(() => setPaused(id, !paused))}>
          {pause.pending ? <Spinner /> : null}
          {paused ? "Resume" : "Pause"}
        </button>
      ) : null}
    </div>
  );
}

export function DeleteMonitor({ id }: { id: string }) {
  return (
    <ConfirmButton confirmLabel="Delete it and its history" onConfirm={() => deleteMonitor(id)}>
      Delete monitor
    </ConfirmButton>
  );
}
