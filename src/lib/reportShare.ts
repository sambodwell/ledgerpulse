/**
 * Shared Executive Report links. The browser sends the report HTML it already renders for the PDF; the server keeps
 * only the <body> markup after passing it through a strict allowlist (text, headings, lists, tables, plain styling —
 * no links, images, forms, scripts or event handlers) and serves it with its own stylesheet and a sandboxing CSP.
 * So a share link can only ever show a report-shaped document, never arbitrary HTML on Sumhaven's domain.
 */

/** Stylesheet of the executive report (used by the PDF/preview and by shared links). */
export const REPORT_CSS = `body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:860px;margin:40px auto;padding:0 20px}
h1{font-size:24px;margin:0}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.muted{color:#666}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}
.kpi{border:1px solid #ddd;border-radius:8px;padding:12px}.kpi b{display:block;font-size:18px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:6px 8px;border-bottom:1px solid #eee;text-align:right}
td:first-child,th:first-child{text-align:left}.neg{color:#b42318}.pos{color:#047857}.warn{color:#b54708}li{margin-bottom:6px}.kpi .muted{font-size:11px}
.pace-banner{margin-top:20px;border:2px solid;border-radius:10px;padding:14px 16px;break-inside:avoid}.pace-good{border-color:#047857;background:#ecfdf5}.pace-bad{border-color:#b42318;background:#fef3f2}
.pace-head{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}.pace-good .pace-head{color:#047857}.pace-bad .pace-head{color:#b42318}
@page{margin:16mm}@media print{body{margin:0;max-width:none}}`;

/** Largest report body accepted for a share link (the real reports are a few tens of KB). */
export const MAX_SHARE_HTML = 400_000;
export const SHARE_TTL_DAYS = [7, 30, 90] as const;
export type ShareTtlDays = (typeof SHARE_TTL_DAYS)[number];

const ALLOWED_TAGS = new Set(["h1", "h2", "h3", "h4", "p", "div", "span", "b", "strong", "em", "i", "small", "br", "ol", "ul", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td"]);
const VOID_TAGS = new Set(["br"]);
/** Elements dropped together with everything inside them. */
const DROP_WITH_CONTENT = /<(script|style|template|iframe|object|embed|svg|math|noscript|textarea|select|title|head)\b[\s\S]*?<\/\1\s*>/gi;
const SAFE_CLASS = /^[\w\s-]{0,120}$/;
/** Inline style values are only kept when they're plain layout/typography (no url(), expressions, imports, escapes). */
const SAFE_STYLE = /^[\w\s#%.,:;()-]{0,200}$/;
const BAD_STYLE = /url\s*\(|expression|@import|javascript|behavior|\\/i;

function escAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes stray `<`/`>` in text runs so nothing outside the allowlist can become markup. Entities are kept. */
function escText(t: string): string {
  return t.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Returns the sanitized body markup of a report document (or fragment). */
export function sanitizeReportHtml(html: string): string {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html);
  const src = (bodyMatch ? bodyMatch[1] : html).replace(/<!--[\s\S]*?-->/g, "").replace(DROP_WITH_CONTENT, "");
  const out: string[] = [];
  const open: string[] = [];
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let last = 0;
  for (let m = tagRe.exec(src); m; m = tagRe.exec(src)) {
    out.push(escText(src.slice(last, m.index)));
    last = tagRe.lastIndex;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue; // unknown tag: dropped, its text content is kept (escaped)
    if (closing) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    const attrs: string[] = [];
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    for (let a = attrRe.exec(m[3]); a; a = attrRe.exec(m[3])) {
      const name = a[1].toLowerCase();
      const value = a[3] ?? a[4] ?? "";
      if (name === "class" && SAFE_CLASS.test(value)) attrs.push(`class="${escAttr(value)}"`);
      else if (name === "style" && SAFE_STYLE.test(value) && !BAD_STYLE.test(value)) attrs.push(`style="${escAttr(value)}"`);
      else if ((name === "colspan" || name === "rowspan") && /^\d{1,2}$/.test(value)) attrs.push(`${name}="${value}"`);
    }
    out.push(`<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>`);
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(m[3])) open.push(tag);
  }
  out.push(escText(src.slice(last)));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join("");
}

/** Full standalone page for a shared report. `body` must already be sanitized. */
export function sharedReportPage(body: string, meta: { title: string; createdAt: string; expiresAt: string }): string {
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const title = escText(meta.title).replace(/"/g, "&quot;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title} · Sumhaven</title>
<style>${REPORT_CSS}
.share-bar{font-size:12px;color:#555;background:#f6f7fb;border:1px solid #e3e6ef;border-radius:8px;padding:8px 12px;margin-bottom:24px}
@media (max-width:640px){.kpis{grid-template-columns:repeat(2,1fr)}body{margin:20px auto}}
@media print{.share-bar{display:none}}</style></head><body>
<div class="share-bar">Shared from Sumhaven on ${escText(day(meta.createdAt))} · read-only snapshot · link expires ${escText(day(meta.expiresAt))}</div>
${body}
</body></html>`;
}
