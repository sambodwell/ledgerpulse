/**
 * Organizes a workspace's saved documents by type and by date, for the sidebar's Documents menu and the
 * Documents manager. Pure; no React.
 */

import { documentRange, type WorkspaceDocument, type WorkspaceDocumentKind } from "@/lib/supabase";
import { periodLabel } from "@/lib/statementPeriod";
import { generatedDocumentName, isGeneratedName } from "@/lib/batchStatements";

export const DOC_KIND_ORDER: WorkspaceDocumentKind[] = ["statement", "pasted", "form"];
export const DOC_KIND_GROUP_LABELS: Record<WorkspaceDocumentKind, string> = {
  statement: "Uploaded statements",
  pasted: "Pasted text",
  form: "Guided entries",
};

const ADDED = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * The name to show for a saved document. Documents saved before names were tidied can carry a raw generated file
 * name ("Gemini code 1793995484670"); those are titled from the months they cover instead ("May 2026 Statement").
 * A name the owner typed is always shown as is.
 */
export function documentTitle(d: WorkspaceDocument): string {
  if (!isGeneratedName(d.name)) return d.name;
  const periods = d.months.length ? d.months.map((m) => m.period) : d.period ? [d.period] : [];
  return generatedDocumentName({ months: periods }, d.kind === "pasted" ? "Pasted statement" : d.kind === "form" ? "Guided entry" : "Statement");
}

/** Newest covered month first; documents without a month go last, newest upload first. */
export function byDateDesc(a: WorkspaceDocument, b: WorkspaceDocument): number {
  const ta = documentRange(a)?.to ?? "";
  const tb = documentRange(b)?.to ?? "";
  if (ta !== tb) return !ta ? 1 : !tb ? -1 : tb.localeCompare(ta);
  return b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name);
}

/** "Mar 2026", "Jan 2026 – Jun 2026", or "Added Mar 3, 2026" for an undated document. */
export function documentDateLabel(d: WorkspaceDocument): string {
  const r = documentRange(d);
  if (r) return r.months === 1 ? periodLabel(r.from) : `${periodLabel(r.from)} – ${periodLabel(r.to)}`;
  return `Added ${ADDED.format(new Date(d.createdAt))}`;
}

export interface DocumentGroup {
  key: string;
  label: string;
  docs: WorkspaceDocument[];
}

/** Grouped by document type (statements, pasted text, guided entries), each group newest first. */
export function groupByKind(docs: WorkspaceDocument[]): DocumentGroup[] {
  return DOC_KIND_ORDER.map((k) => ({ key: k, label: DOC_KIND_GROUP_LABELS[k], docs: docs.filter((d) => d.kind === k).sort(byDateDesc) })).filter((g) => g.docs.length);
}

/** Grouped by the year of the latest month a document covers (or its upload year), newest year first. */
export function groupByYear(docs: WorkspaceDocument[]): DocumentGroup[] {
  const map = new Map<string, WorkspaceDocument[]>();
  for (const d of docs) {
    const r = documentRange(d);
    const year = r ? r.to.slice(0, 4) : `Undated`;
    map.set(year, [...(map.get(year) ?? []), d]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === "Undated" ? 1 : b === "Undated" ? -1 : b.localeCompare(a)))
    .map(([key, list]) => ({ key, label: key === "Undated" ? "No statement month" : key, docs: list.sort(byDateDesc) }));
}
