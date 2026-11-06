/**
 * Turns a self-contained HTML report into a real .pdf file and downloads it directly.
 *
 * Why not `window.print()`: Safari / Chrome on macOS open the native print preview for that, so "Download PDF"
 * looked like a print dialog. Here the report is laid out in an off-screen iframe (its own document, so the app's
 * styles never leak in), rasterized with html2canvas, split into Letter pages at element boundaries (rows, list
 * items, paragraphs — never mid-line) and saved with jsPDF, which triggers a plain file download.
 *
 * Both libraries are loaded on demand, so they cost nothing until someone downloads a report.
 */

/** CSS width the report is laid out at (the report's own max-width is 860px + padding). */
const LAYOUT_WIDTH = 900;
/** US Letter in points, with 0.5in margins. */
const PAGE = { w: 612, h: 792, margin: 36 };
/** Blocks a page may end after. */
const BREAK_SELECTOR = "h1,h2,h3,p,li,tr,.kpis,.pace-banner,svg,table,ol,ul,div";

/** "LedgerPulse Executive Report – 123 Main St" → "LedgerPulse-Executive-Report-123-Main-St". */
export function pdfFileName(...parts: (string | null | undefined)[]): string {
  const base = parts
    .filter((p): p is string => !!p && !!p.trim())
    .join(" ")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return `${base || "LedgerPulse-Report"}.pdf`;
}

function loadFrame(html: string): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // Off-screen but laid out (visibility:hidden / display:none would give html2canvas nothing to draw).
    frame.style.cssText = `position:fixed;left:-${LAYOUT_WIDTH * 3}px;top:0;width:${LAYOUT_WIDTH}px;height:1200px;border:0;pointer-events:none`;
    const timer = setTimeout(() => {
      frame.remove();
      reject(new Error("The report took too long to lay out."));
    }, 15_000);
    frame.onload = () => {
      clearTimeout(timer);
      resolve(frame);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

/** Page-end candidates (document y, CSS px): the bottom edge of every block in the report. */
function breakPoints(doc: Document): number[] {
  const out = new Set<number>();
  doc.querySelectorAll(BREAK_SELECTOR).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height > 0) out.add(Math.round(r.bottom + doc.defaultView!.scrollY));
  });
  return [...out].sort((a, b) => a - b);
}

/** Splits `total` px into page slices no taller than `pagePx`, ending each page on a block boundary when one fits. */
function slicePages(total: number, pagePx: number, breaks: number[]): [number, number][] {
  const pages: [number, number][] = [];
  let y = 0;
  while (y < total - 1) {
    const limit = y + pagePx;
    let end = total;
    if (limit < total) {
      // The last boundary that still fits, as long as it fills at least 60% of the page; otherwise cut at the limit.
      const fit = breaks.filter((b) => b > y + pagePx * 0.6 && b <= limit);
      end = fit.length ? fit[fit.length - 1] : limit;
    }
    pages.push([y, end]);
    y = end;
  }
  return pages;
}

/** Renders `html` (a complete document) to a multi-page PDF and downloads it as `fileName`. */
export async function downloadHtmlAsPdf(html: string, fileName: string): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas")]);
  const frame = await loadFrame(html);
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("Couldn't prepare the report.");
    await doc.fonts?.ready;
    const root = doc.documentElement;
    const total = Math.ceil(root.scrollHeight);
    frame.style.height = `${total}px`;

    const scale = 2;
    const canvas = await html2canvas(root, {
      scale,
      backgroundColor: "#ffffff",
      width: LAYOUT_WIDTH,
      height: total,
      windowWidth: LAYOUT_WIDTH,
      windowHeight: total,
      logging: false,
      useCORS: true,
    });

    const contentW = PAGE.w - PAGE.margin * 2;
    const contentH = PAGE.h - PAGE.margin * 2;
    const ptPerPx = contentW / LAYOUT_WIDTH;
    const pagePx = Math.floor(contentH / ptPerPx);
    const pages = slicePages(total, pagePx, breakPoints(doc));

    const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait", compress: true });
    pdf.setProperties({ title: fileName.replace(/\.pdf$/i, "").replace(/-/g, " "), creator: "LedgerPulse" });
    const slice = document.createElement("canvas");
    const ctx = slice.getContext("2d");
    if (!ctx) throw new Error("Your browser couldn't render the PDF.");
    pages.forEach(([from, to], i) => {
      const hPx = to - from;
      slice.width = canvas.width;
      slice.height = Math.max(1, Math.round(hPx * scale));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, Math.round(from * scale), canvas.width, slice.height, 0, 0, slice.width, slice.height);
      if (i > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/png"), "PNG", PAGE.margin, PAGE.margin, contentW, hPx * ptPerPx, undefined, "FAST");
      pdf.setFontSize(8);
      pdf.setTextColor(140);
      pdf.text(`Page ${i + 1} of ${pages.length}`, PAGE.w - PAGE.margin, PAGE.h - 16, { align: "right" });
    });
    // jsPDF.save() builds a Blob and clicks a download link: a direct file download, no print dialog.
    pdf.save(fileName);
  } finally {
    frame.remove();
  }
}
