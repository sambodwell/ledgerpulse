"use client";

import { useEffect } from "react";

export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 px-4 text-slate-100">
      <div className="max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center backdrop-blur-xl">
        <h2 className="text-lg font-semibold">The dashboard hit an unexpected error</h2>
        <p className="mt-2 text-sm text-slate-400">Your data wasn&apos;t lost. Try loading the dashboard again.</p>
        <button onClick={() => retry()} className="mt-5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400">
          Try again
        </button>
      </div>
    </div>
  );
}
