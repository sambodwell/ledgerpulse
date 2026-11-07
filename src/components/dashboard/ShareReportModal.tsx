"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download, Eye, Link2, Loader2, Mail, Share2, ShieldCheck, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { authHeaders } from "@/lib/supabase";
import { downloadHtmlAsPdf, htmlToPdfFile } from "@/lib/pdfDownload";
import { SHARE_TTL_DAYS, type ShareTtlDays } from "@/lib/reportShare";
import { cn, errorMessage, inputCls, primaryBtn, secondaryBtn } from "@/components/ui";
import type { ReportShare } from "@/app/api/reports/share/route";

const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The caller's active share links (empty when none, or when sharing isn't set up yet). */
async function fetchLinks(workspaceId: string | null): Promise<ReportShare[]> {
  try {
    const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    const res = await fetch(`/api/reports/share${qs}`, { headers: await authHeaders(), cache: "no-store" });
    return res.ok ? ((await res.json()) as { shares: ReportShare[] }).shares : [];
  } catch {
    return [];
  }
}

/**
 * Share the Executive Report: download the PDF, send the PDF file through the device share sheet (where the browser
 * supports sharing files), or create a read-only link (expiring, revocable) to copy, email or share.
 */
export function ShareReportModal({
  onClose,
  buildHtml,
  fileName,
  title,
  workspaceId,
}: {
  onClose: () => void;
  /** Builds the current report HTML (the same document the PDF is made from). */
  buildHtml: () => string;
  fileName: string;
  title: string;
  workspaceId: string | null;
}) {
  const [ttl, setTtl] = useState<ShareTtlDays>(30);
  const [busy, setBusy] = useState<"link" | "pdf" | "file" | `revoke:${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ReportShare | null>(null);
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState<ReportShare[] | null>(null);
  // The modal only mounts after a click, so navigator is always available here.
  const [canShareFiles] = useState(() => {
    try {
      const probe = new File([new Blob(["x"])], "x.pdf", { type: "application/pdf" });
      return typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [probe] });
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;
    void fetchLinks(workspaceId).then((l) => !cancelled && setLinks(l));
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // The user closing the share sheet isn't an error.
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const createLink = () =>
    run("link", async () => {
      const res = await fetch("/api/reports/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ html: buildHtml(), title, workspaceId, ttlDays: ttl }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const { share } = (await res.json()) as { share: ReportShare };
      setCreated(share);
      setCopied(false);
      setLinks((cur) => [share, ...(cur ?? []).filter((s) => s.id !== share.id)]);
      try {
        await navigator.clipboard.writeText(share.url);
        setCopied(true);
      } catch {
        /* clipboard blocked: the link is shown to copy by hand */
      }
    });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically. Select the link and copy it.");
    }
  };

  const nativeShareLink = (url: string) => run("link", async () => void (await navigator.share({ title: `Sumhaven ${title}`, text: "Here's my Sumhaven executive report:", url })));

  const revoke = (id: string) =>
    run(`revoke:${id}`, async () => {
      const res = await fetch(`/api/reports/share?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error(await errorMessage(res));
      setLinks((cur) => (cur ?? []).filter((s) => s.id !== id));
      if (created?.id === id) setCreated(null);
    });

  const sharePdfFile = () =>
    run("file", async () => {
      const file = await htmlToPdfFile(buildHtml(), fileName);
      await navigator.share({ files: [file], title: `Sumhaven ${title}` });
    });

  const downloadPdf = () => run("pdf", () => downloadHtmlAsPdf(buildHtml(), fileName));

  const mailto = (url: string) => `mailto:?subject=${encodeURIComponent(`Sumhaven ${title}`)}&body=${encodeURIComponent(`Here's my Sumhaven executive report (read-only):\n\n${url}`)}`;
  const hasNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const working = busy !== null;

  return (
    <Modal
      size="lg"
      dismissible={!working}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Share2 className="h-5 w-5 text-indigo-300" aria-hidden /> Share executive report
        </span>
      }
      subtitle="Download the PDF, send it from your device, or create a read-only link anyone can open."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={downloadPdf} disabled={working} className={cn(primaryBtn, "w-full")}>
          {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
        </button>
        {canShareFiles ? (
          <button type="button" onClick={sharePdfFile} disabled={working} className={cn(secondaryBtn, "w-full")}>
            {busy === "file" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} {busy === "file" ? "Preparing PDF…" : "Send PDF from this device"}
          </button>
        ) : (
          <p className="self-center text-xs text-slate-500">Tip: download the PDF to attach it to an email, or share a link below.</p>
        )}
      </div>

      <section aria-labelledby="share-link-heading" className="mt-5 rounded-xl border border-white/10 bg-slate-950/30 p-4">
        <h3 id="share-link-heading" className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <Link2 className="h-4 w-4 text-indigo-300" aria-hidden /> Share by link
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Creates a read-only snapshot of this report as it looks now. Anyone with the link can view it until it expires or you revoke it. Your statements and workspace stay private.
        </p>

        {created ? (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" className={cn(inputCls, "font-mono text-xs")} />
              <button type="button" onClick={() => void copy(created.url)} className={cn(secondaryBtn, "shrink-0")}>
                {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {hasNativeShare && (
                <button type="button" onClick={() => nativeShareLink(created.url)} disabled={working} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
                  <Share2 className="h-3.5 w-3.5" /> Share…
                </button>
              )}
              <a href={mailto(created.url)} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
                <Mail className="h-3.5 w-3.5" /> Email
              </a>
              <a href={created.url} target="_blank" rel="noreferrer" className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
                <Eye className="h-3.5 w-3.5" /> Preview
              </a>
            </div>
            <p className="text-xs text-slate-500">
              <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-300" aria-hidden />
              Expires {DAY_FMT.format(new Date(created.expiresAt))}. Made changes? Create a new link to share the updated report.
            </p>
            <button type="button" onClick={() => setCreated(null)} className="text-xs text-indigo-300 hover:text-indigo-200">
              Create another link
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-400">
              Link expires after
              <select value={ttl} onChange={(e) => setTtl(Number(e.target.value) as ShareTtlDays)} className={cn(inputCls, "mt-1 w-32 py-1.5")}>
                {SHARE_TTL_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={createLink} disabled={working} className={primaryBtn}>
              {busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Create share link
            </button>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      )}

      {links && links.length > 0 && (
        <section aria-labelledby="active-links-heading" className="mt-5">
          <h3 id="active-links-heading" className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Active links{workspaceId ? " for this workspace" : ""}
          </h3>
          <ul className="mt-2 divide-y divide-white/5 rounded-xl border border-white/10">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 text-slate-300">
                  Created {DAY_FMT.format(new Date(l.createdAt))} · expires {DAY_FMT.format(new Date(l.expiresAt))} · {l.views} view{l.views === 1 ? "" : "s"}
                </span>
                <span className="flex gap-1">
                  <button type="button" onClick={() => void copy(l.url)} className="rounded-md px-2 py-1 text-indigo-300 hover:bg-white/5">
                    Copy
                  </button>
                  <button type="button" onClick={() => revoke(l.id)} disabled={working} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
                    {busy === `revoke:${l.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Revoke
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}
