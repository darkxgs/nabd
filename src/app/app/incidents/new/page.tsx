import type { Metadata } from "next";
import Link from "next/link";
import { NewIncidentForm } from "@/components/app/incident-forms";
import { PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Post an incident" };

export default function NewIncidentPage() {
  return (
    <>
      <Link href="/app/incidents" className="text-[13.5px] text-muted hover:text-ink">
        Incidents
      </Link>
      <div className="mt-2">
        <PageTitle title="Post an incident" sub="For planned maintenance, or a problem your checks can't see, like a payment provider failing." />
      </div>
      <div className="mt-8">
        <NewIncidentForm />
      </div>
    </>
  );
}
