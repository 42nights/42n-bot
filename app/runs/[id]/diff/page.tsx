"use client";

import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { DiffView } from "@/components/DiffView";
import { ArrowLeft } from "lucide-react";

export default function FullDiff({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data } = useSWR<{ diff: string }>(`/api/runs/${id}/diff`, fetcher);
  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <Link
        href={`/runs/${id}`}
        className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to run
      </Link>
      <h1 className="font-serif text-2xl mt-4 mb-4">Diff · run #{id}</h1>
      <DiffView diff={data?.diff ?? ""} />
    </div>
  );
}
