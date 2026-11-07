"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Briefcase,
  Check,
  ChevronDown,
  CreditCard,
  FileText,
  FolderOpen,
  Home,
  LayoutDashboard,
  Loader2,
  Menu,
  Plus,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { BUSINESS_ONLY_TYPES, BUSINESS_TYPE_LABELS, type BusinessType, type WorkspaceMode, type WorkspaceProfile } from "@/lib/schemas";
import type { WorkspaceDocument } from "@/lib/supabase";
import { documentDateLabel, documentTitle, groupByKind } from "@/lib/documentGroups";
import { useApp } from "@/components/AppProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { cn, glass, inputCls, primaryBtn, secondaryBtn } from "@/components/ui";

/** The Documents nav item's data, when the page has the active workspace's documents loaded (the dashboard). */
export interface SidebarDocuments {
  docs: WorkspaceDocument[];
  loading: boolean;
  /** Opens the Documents manager (optionally scrolled to one document). */
  onOpen: (docId?: string) => void;
  /** Opens the statement uploader's file picker to add more months (shown as "Upload More Documents"). */
  onUploadMore?: () => void;
}

interface SidebarProps {
  documents?: SidebarDocuments;
  /** Opens the active workspace's settings in place; without it the item links to the dashboard's settings. */
  onOpenWorkspaceSettings?: () => void;
}

const MODE_META: Record<WorkspaceMode, { label: string; Icon: typeof Home; badge: string }> = {
  BUSINESS: { label: "Business", Icon: Briefcase, badge: "border-indigo-300/30 bg-indigo-500/15 text-indigo-100" },
  PERSONAL: { label: "Personal", Icon: Home, badge: "border-emerald-300/30 bg-emerald-500/15 text-emerald-100" },
};

/**
 * App frame for signed-in pages: a left sidebar (desktop) or a top bar with a slide-out drawer (mobile) that always
 * shows which book you're in, lists every workspace grouped Business / Personal, and has a prominent
 * "Create New Workspace" button — so switching books and starting a new one never hides behind the profile menu.
 */
export function AppShell({ children, ...props }: SidebarProps & { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  const app = useApp();
  const ws = app.activeWorkspace;
  const pathname = usePathname();

  // Close the drawer on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setDrawer(false);
  }
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [drawer]);

  const openCreate = () => {
    setDrawer(false);
    setCreating(true);
  };

  return (
    <div className="relative lg:flex">
      {/* Desktop sidebar */}
      <aside aria-label="Workspaces and navigation" className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-slate-950/70 backdrop-blur-xl lg:flex">
        <SidebarContent {...props} onCreate={openCreate} />
      </aside>

      {/* Mobile / tablet top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-white/10 bg-slate-950/90 px-3 py-2 backdrop-blur-xl lg:hidden">
        <button type="button" onClick={() => setDrawer(true)} aria-label="Open workspaces menu" aria-expanded={drawer} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-slate-200 hover:bg-white/5">
          <Menu className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setDrawer(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left">
          {ws ? <ModeIcon mode={ws.mode} /> : <FolderOpen className="h-4 w-4 shrink-0 text-slate-500" />}
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-wide text-slate-500">You&apos;re in</span>
            <span className="block truncate text-sm font-medium text-slate-100">{ws ? ws.name : "No workspace selected"}</span>
          </span>
        </button>
        {app.user && (
          <button type="button" onClick={openCreate} aria-label="Create new workspace" className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-500 text-white hover:bg-indigo-400">
            <Plus className="h-4 w-4" />
          </button>
        )}
        <ThemeToggle variant="inline" compact className="h-9 w-9 justify-center px-0" />
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-[58] lg:hidden" role="dialog" aria-modal="true" aria-label="Workspaces and navigation">
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col overflow-y-auto border-r border-white/10 bg-slate-950 shadow-2xl">
            <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <SidebarContent {...props} onCreate={openCreate} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1">{children}</div>

      {creating && <CreateWorkspaceDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function ModeIcon({ mode, className }: { mode: WorkspaceMode; className?: string }) {
  const { Icon } = MODE_META[mode];
  return <Icon className={cn("h-4 w-4 shrink-0", mode === "PERSONAL" ? "text-emerald-300" : "text-indigo-300", className)} aria-hidden />;
}

function SidebarContent({ documents, onOpenWorkspaceSettings, onCreate, onNavigate }: SidebarProps & { onCreate: () => void; onNavigate?: () => void }) {
  const app = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const ws = app.activeWorkspace;
  const onDashboard = pathname === "/dashboard";

  const switchTo = (w: WorkspaceProfile) => {
    if (w.id !== ws?.id) app.setActiveWorkspaceId(w.id);
    onNavigate?.();
    if (!onDashboard) router.push("/dashboard");
  };

  const groups = (["BUSINESS", "PERSONAL"] as const).map((m) => ({ mode: m, list: app.workspaces.filter((w) => w.mode === m) })).filter((g) => g.list.length);

  return (
    <div className="flex min-h-full flex-1 flex-col gap-5 px-4 py-5">
      <Link href="/dashboard" onClick={onNavigate} aria-label="Sumhaven home" className="flex items-center px-1">
        <BrandLogo height={30} preload />
      </Link>

      {/* Which book you're in */}
      <section aria-label="Current workspace">
        <p className="px-1 pb-1.5 text-[11px] uppercase tracking-wide text-slate-500">You&apos;re in</p>
        {ws ? (
          <div className={cn(glass, "rounded-xl p-3")}>
            <p className="flex items-start gap-2 font-medium text-slate-100">
              <ModeIcon mode={ws.mode} className="mt-0.5" />
              <span className="min-w-0 break-words">{ws.name}</span>
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={cn("rounded-full border px-2 py-0.5 font-medium", MODE_META[ws.mode].badge)}>{MODE_META[ws.mode].label} book</span>
              {ws.mode === "BUSINESS" && <span className="text-slate-500">{BUSINESS_TYPE_LABELS[ws.businessType].split(" (")[0]}</span>}
            </p>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-white/15 px-3 py-2.5 text-xs text-slate-400">
            {app.user ? "No workspace selected. Pick one below or create a new one." : "Sign in to keep separate workspaces."}
          </p>
        )}
      </section>

      {app.user && (
        <button type="button" onClick={onCreate} className={cn(primaryBtn, "w-full shadow-lg shadow-indigo-500/20")}>
          <Plus className="h-4 w-4" /> Create New Workspace
        </button>
      )}

      {/* Workspace switcher */}
      {app.user && (
        <nav aria-label="Workspaces" className="-mt-1">
          <p className="px-1 pb-1.5 text-[11px] uppercase tracking-wide text-slate-500">Workspaces</p>
          {!app.ready ? (
            <p className="flex items-center gap-2 px-1 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
          ) : groups.length === 0 ? (
            <p className="px-1 text-xs text-slate-500">No workspaces yet.</p>
          ) : (
            <div className="max-h-[38vh] space-y-3 overflow-y-auto overscroll-contain pr-1">
              {groups.map((g) => (
                <div key={g.mode}>
                  <p className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-medium text-slate-400">
                    <ModeIcon mode={g.mode} className="h-3.5 w-3.5" /> {MODE_META[g.mode].label}
                  </p>
                  <ul className="space-y-0.5">
                    {g.list.map((w) => {
                      const active = w.id === ws?.id;
                      return (
                        <li key={w.id}>
                          <button
                            type="button"
                            onClick={() => switchTo(w)}
                            aria-current={active ? "true" : undefined}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition",
                              active ? "bg-indigo-500/15 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{w.name}</span>
                            {active && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-300" aria-label="Active" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </nav>
      )}

      {/* App navigation */}
      <nav aria-label="Main" className="space-y-0.5 border-t border-white/10 pt-4">
        <NavLink href="/dashboard" active={onDashboard} Icon={LayoutDashboard} onClick={onNavigate}>
          Dashboard
        </NavLink>
        {ws && <DocumentsNav documents={documents} onNavigate={onNavigate} />}
        {ws &&
          (onOpenWorkspaceSettings ? (
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                onOpenWorkspaceSettings();
              }}
              className={navCls(false)}
            >
              <Settings2 className="h-4 w-4 text-slate-400" /> Workspace settings
            </button>
          ) : (
            <NavLink href="/dashboard?open=workspace-settings" Icon={Settings2} onClick={onNavigate}>
              Workspace settings
            </NavLink>
          ))}
        <NavLink href="/settings" active={pathname === "/settings"} Icon={CreditCard} onClick={onNavigate}>
          Account &amp; billing
        </NavLink>
      </nav>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/10 pt-4">
        <ThemeToggle variant="inline" />
      </div>
    </div>
  );
}

const navCls = (active: boolean) =>
  cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition", active ? "bg-white/[0.07] text-white" : "text-slate-300 hover:bg-white/5 hover:text-white");

function NavLink({ href, active = false, Icon, onClick, children }: { href: string; active?: boolean; Icon: typeof Home; onClick?: () => void; children: ReactNode }) {
  return (
    <Link href={href} onClick={onClick} aria-current={active ? "page" : undefined} className={navCls(active)}>
      <Icon className="h-4 w-4 text-slate-400" /> {children}
    </Link>
  );
}

/** "Documents" dropdown: this workspace's saved documents, grouped by type, newest month first. */
function DocumentsNav({ documents, onNavigate }: { documents?: SidebarDocuments; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!documents) {
    // Pages without the documents loaded (Settings) open the manager / uploader on the dashboard.
    return (
      <>
        <NavLink href="/dashboard?open=documents" Icon={FolderOpen} onClick={onNavigate}>
          Documents
        </NavLink>
        <Link href="/dashboard?open=upload" onClick={onNavigate} className={uploadMoreCls}>
          <Upload className="h-4 w-4" /> Upload More Documents
        </Link>
      </>
    );
  }
  const { docs, loading, onOpen, onUploadMore } = documents;
  const groups = groupByKind(docs);
  const open_ = (id?: string) => {
    onNavigate?.();
    onOpen(id);
  };
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={listId} className={navCls(open)}>
        <FolderOpen className="h-4 w-4 text-slate-400" />
        <span className="flex-1">Documents</span>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" /> : <span className="rounded-full bg-white/10 px-1.5 text-[11px] tabular-nums text-slate-300">{docs.length}</span>}
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-500 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id={listId} className="mb-1 ml-3 mt-1 border-l border-white/10 pl-3">
          {docs.length === 0 ? (
            <p className="py-1.5 text-xs text-slate-500">{loading ? "Loading documents…" : "No documents saved in this workspace yet. Statements you upload are kept here."}</p>
          ) : (
            <div className="max-h-[40vh] space-y-2.5 overflow-y-auto overscroll-contain py-1 pr-1">
              {groups.map((g) => (
                <div key={g.key}>
                  <p className="pb-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    {g.label} · {g.docs.length}
                  </p>
                  <ul>
                    {g.docs.slice(0, 6).map((d) => (
                      <li key={d.id}>
                        <button type="button" onClick={() => open_(d.id)} className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-white/5" title={d.fileName && d.fileName !== documentTitle(d) ? `${documentTitle(d)} (${d.fileName})` : documentTitle(d)}>
                          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300" aria-hidden />
                          <span className="min-w-0">
                            <span className="block truncate text-xs text-slate-200">{documentTitle(d)}</span>
                            <span className="block text-[10px] text-slate-500">{documentDateLabel(d)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {g.docs.length > 6 && (
                    <button type="button" onClick={() => open_()} className="px-1.5 text-[11px] text-indigo-300 hover:text-indigo-200">
                      +{g.docs.length - 6} more
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={() => open_()} className="mt-1 inline-flex items-center gap-1 px-1.5 py-1 text-xs text-indigo-300 hover:text-indigo-200">
            <FolderOpen className="h-3.5 w-3.5" /> Manage all documents
          </button>
        </div>
      )}
      {onUploadMore && (
        // Always visible (not inside the dropdown): adding the next month's statements shouldn't need a hunt.
        <button
          type="button"
          onClick={() => {
            // The picker opens inside this click (browsers only allow it from a user gesture), then the drawer closes.
            onUploadMore();
            onNavigate?.();
          }}
          className={uploadMoreCls}
        >
          <Upload className="h-4 w-4" /> Upload More Documents
        </button>
      )}
    </div>
  );
}

const uploadMoreCls =
  "mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-300/40 bg-indigo-500/15 px-3 py-2 text-sm font-medium text-indigo-100 transition hover:bg-indigo-500/25";

/**
 * "Create New Workspace": pick Business or Personal first (that choice is permanent for the book), name it, and — for a
 * business — pick its type. The new workspace starts completely empty and becomes the active one.
 */
export function CreateWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [mode, setMode] = useState<WorkspaceMode>(app.activeWorkspace?.mode ?? (app.profile?.planCategory === "PERSONAL_FAMILY" ? "PERSONAL" : "BUSINESS"));
  const [businessType, setBusinessType] = useState<Exclude<BusinessType, "PERSONAL_FAMILY">>("REAL_ESTATE");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  useEffect(() => nameRef.current?.focus(), [mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the workspace a name.");
    setBusy(true);
    setError(null);
    try {
      await app.createFreshWorkspace({ name, businessType: mode === "PERSONAL" ? "PERSONAL_FAMILY" : businessType });
      onClose();
      if (pathname !== "/dashboard") router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the workspace.");
      setBusy(false);
    }
  };

  const kind = (m: WorkspaceMode, title: string, blurb: string) => {
    const on = mode === m;
    return (
      <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition", on ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/10 hover:bg-white/5")}>
        <input type="radio" name="ws-kind" className="sr-only" checked={on} onChange={() => setMode(m)} />
        <ModeIcon mode={m} className="mt-0.5 h-5 w-5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
            {title} {on && <Check className="h-4 w-4 text-indigo-300" aria-hidden />}
          </span>
          <span className="mt-0.5 block text-xs text-slate-400">{blurb}</span>
        </span>
      </label>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn(glass, "w-full max-w-lg bg-slate-900/95 p-6")}>
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold">
            <Plus className="h-5 w-5 text-indigo-300" /> Create New Workspace
          </h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-sm text-slate-400">Each workspace is its own book: separate report, documents, goals, monthly actuals and scenarios. Nothing is copied from your other workspaces.</p>

        <fieldset className="mt-4">
          <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">What kind of book?</legend>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            {kind("BUSINESS", "Business", "A company, rental property, job or side business: P&L, margins and runway.")}
            {kind("PERSONAL", "Personal / Household", "Household income and spending, checked against 50/30/20.")}
          </div>
        </fieldset>

        <label className="mt-4 block text-sm">
          <span className="text-slate-300">Name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            placeholder={mode === "PERSONAL" ? 'e.g. "Family Budget 2026"' : 'e.g. "123 Main St Duplex"'}
            className={cn(inputCls, "mt-1")}
          />
        </label>

        {mode === "BUSINESS" && (
          <label className="mt-3 block text-sm">
            <span className="text-slate-300">Business type</span>
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value as typeof businessType)} className={cn(inputCls, "mt-1")}>
              {BUSINESS_ONLY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BUSINESS_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="mt-3 text-xs text-slate-500">The Business / Personal choice is fixed for this workspace so its numbers never mix with the other kind.</p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-200">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={cn(secondaryBtn, "text-slate-300")}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim()} className={primaryBtn}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create workspace
          </button>
        </div>
      </form>
    </div>
  );
}
