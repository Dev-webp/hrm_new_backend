import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";

import fs from "fs";

const config = Object.freeze({
  concurrency: Math.max(1, Number(process.env.PDF_CONCURRENCY || 2)),
  maxQueue: Math.max(0, Number(process.env.PDF_MAX_QUEUE || 10)),
  launchTimeoutMs: Math.max(1000, Number(process.env.PDF_LAUNCH_TIMEOUT_MS || 15000)),
  renderTimeoutMs: Math.max(1000, Number(process.env.PDF_RENDER_TIMEOUT_MS || 15000)),
  generationTimeoutMs: Math.max(1000, Number(process.env.PDF_GENERATION_TIMEOUT_MS || 30000)),
  shutdownTimeoutMs: Math.max(1000, Number(process.env.PDF_SHUTDOWN_TIMEOUT_MS || 5000)),
  idleTimeoutMs: Math.max(0, Number(process.env.PDF_BROWSER_IDLE_TIMEOUT_MS || 30000)),
});

let browser = null;
let launchPromise = null;
let activeJobs = 0;
let idleTimer = null;
const queue = [];

export class PdfGenerationError extends Error {
  constructor(code, message, { statusCode = 500, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PdfGenerationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const now = () => performance.now();
const duration = (startedAt) => Math.round(now() - startedAt);
const templateDetails = (html) => html.includes("Dynamic offer-letter placeholders")
  ? { letterType: "OFFER", templateName: "offerLetterTemplate.html" }
  : html.includes("EXPERIENCE &amp; RELIEVING LETTER") || html.includes("EXPERIENCE & RELIEVING LETTER")
    ? { letterType: "EXPERIENCE_RELIEVING", templateName: "experienceRelievingTemplate.html" }
    : { letterType: "UNKNOWN", templateName: "unknown" };

function timeout(operation, timeoutMs, code, message) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new PdfGenerationError(code, message, { statusCode: 504 })), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function invalidateBrowser(instance) {
  if (browser === instance) browser = null;
  if (launchPromise) launchPromise = null;
}

async function forceClose(instance) {
  try { await timeout(instance.close(), config.shutdownTimeoutMs, "BROWSER_SHUTDOWN_TIMEOUT", "Browser shutdown timed out."); }
  catch {
    try { instance.process()?.kill("SIGKILL"); } catch { /* best-effort process cleanup */ }
  } finally { invalidateBrowser(instance); }
}

async function getBrowser() {
  if (browser?.connected) return browser;
  if (!launchPromise) {
    const pendingLaunch = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    launchPromise = timeout(pendingLaunch, config.launchTimeoutMs, "BROWSER_LAUNCH_TIMEOUT", "Browser launch timed out.")
      .then((instance) => {
        browser = instance;
        instance.once("disconnected", () => invalidateBrowser(instance));
        return instance;
      })
      .catch(async (error) => {
        pendingLaunch.then((instance) => forceClose(instance)).catch(() => {});
        throw error instanceof PdfGenerationError ? error : new PdfGenerationError("BROWSER_LAUNCH_FAILED", "Browser launch failed.", { cause: error });
      })
      .finally(() => { launchPromise = null; });
  }
  return launchPromise;
}

function scheduleIdleShutdown() {
  clearIdleTimer();
  if (!config.idleTimeoutMs || activeJobs || queue.length || !browser?.connected) return;
  idleTimer = setTimeout(() => { const instance = browser; if (instance && !activeJobs && !queue.length) forceClose(instance); }, config.idleTimeoutMs);
  idleTimer.unref?.();
}

function enqueue(job) {
  if (activeJobs >= config.concurrency && queue.length >= config.maxQueue) {
    return Promise.reject(new PdfGenerationError("PDF_QUEUE_FULL", "PDF generation queue is full. Please try again shortly.", { statusCode: 429 }));
  }
  return new Promise((resolve, reject) => {
    queue.push({ job, resolve, reject });
    drainQueue();
  });
}

function drainQueue() {
  clearIdleTimer();
  while (activeJobs < config.concurrency && queue.length) {
    const next = queue.shift();
    activeJobs += 1;
    next.job().then(next.resolve, next.reject).finally(() => { activeJobs -= 1; drainQueue(); scheduleIdleShutdown(); });
  }
}

async function verifyDocument(page) {
  const assets = await page.evaluate(async () => {
    await document.fonts?.ready;
    const images = [...document.images].map((image) => ({ src: image.getAttribute("src") || "", complete: image.complete, width: image.naturalWidth, height: image.naturalHeight }));
    return {
      readyState: document.readyState,
      stylesheets: document.styleSheets.length,
      fonts: document.fonts?.status || "unsupported",
      images,
    };
  });
  const failedImages = assets.images.filter((image) => !image.complete || !image.width || !image.height);
  if (assets.readyState !== "complete" || !assets.stylesheets || assets.fonts === "loading") throw new PdfGenerationError("ASSET_VERIFICATION_FAILED", "Required document styles or fonts are unavailable.");
  if (failedImages.length) throw new PdfGenerationError("ASSET_VERIFICATION_FAILED", "Required document assets are unavailable.");
  return { imageCount: assets.images.length, fontStatus: assets.fonts };
}

async function renderPdf(html) {
  if (!String(html || "").trim()) throw new PdfGenerationError("TEMPLATE_ERROR", "PDF HTML is empty.", { statusCode: 422 });
  if (/\{\{\s*[A-Za-z0-9_]+\s*\}\}/.test(html)) throw new PdfGenerationError("PLACEHOLDER_VALIDATION_ERROR", "PDF HTML contains unresolved placeholders.", { statusCode: 422 });
  const startedAt = now();
  const details = templateDetails(html);
  const launchStartedAt = now();
  const instance = await getBrowser();
  const browserLaunchDurationMs = duration(launchStartedAt);
  let page;
  try {
    page = await timeout(
    instance.newPage(),
    config.renderTimeoutMs,
    "RENDER_TIMEOUT",
    "Page creation timed out."
);

// ADD THIS
await page.setViewport({
    width: 794,
    height: 1123,
    deviceScaleFactor: 1,
});

const renderStartedAt = now();

await page.emulateMediaType("print");

fs.writeFileSync("debug-experience.html", html);

await timeout(
    page.setContent(html, {
        waitUntil: "networkidle0"
    }),
    config.renderTimeoutMs,
    "RENDER_TIMEOUT",
    "HTML rendering timed out."
);

await page.screenshot({
    path: "puppeteer-render.png",
    fullPage: true,
});

await page.evaluate(async () => {
    await document.fonts.ready;
});

await page.evaluate(() => {
    document.body.offsetHeight;
});
    if (details.letterType === "OFFER") {
      // The legacy Offer template declares an A4 print page even though each
      // of its fixed canvases is 1059.40625 x 1500.578125 CSS pixels. Override
      // only the print page box at render time so Chromium fragments on the
      // same boundaries as those canvases, without altering template markup.
      await timeout(
        page.addStyleTag({ content: "@page { size: 1059.40625px 1500.578125px !important; margin: 0 !important; }" }),
        config.renderTimeoutMs,
        "RENDER_TIMEOUT",
        "Offer print layout setup timed out."
      );
    }

     
    const assets = await timeout(verifyDocument(page), config.renderTimeoutMs, "RENDER_TIMEOUT", "Asset verification timed out.");
    const renderDurationMs = duration(renderStartedAt);
    const pdfStartedAt = now();

    // Offer pages are fixed-size canvases. Printing them on A4 makes each
    // canvas overflow and split into an additional blank PDF page.
    const pdfOptions = details.letterType === "OFFER"
      ? {
          printBackground: true,
          preferCSSPageSize: true,
          scale: 1,
          margin: { top: "0px", right: "0px", bottom: "0px", left: "0px" },
        }
      : {
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        };

    const pdf = await timeout(page.pdf(pdfOptions), config.generationTimeoutMs, "PDF_TIMEOUT", "PDF generation timed out.");
    if (!pdf?.length) throw new PdfGenerationError("PDF_GENERATION_FAILED", "Generated PDF is empty.");
    const pageCount = (await PDFDocument.load(pdf)).getPageCount();
    console.info("[PDF_JOB_DIAGNOSTICS]", {
      ...details,
      placeholderCount: (html.match(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g) || []).length,
      browserLaunchDurationMs,
      renderDurationMs,
      pdfDurationMs: duration(pdfStartedAt),
      totalDurationMs: duration(startedAt),
      pageCount,
      generatedPdfBytes: pdf.length,
      imageCount: assets.imageCount,
      fontStatus: assets.fontStatus,
      memoryRssBytes: process.memoryUsage?.().rss,
    });
    return Buffer.from(pdf);
  } catch (error) {
    if (error instanceof PdfGenerationError) throw error;
    throw new PdfGenerationError("PDF_GENERATION_FAILED", "PDF generation failed.", { cause: error });
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/** Generates an A4 PDF while reusing a managed Chromium instance. */
export function createPdf(html) { return enqueue(() => renderPdf(html)); }

/** Allows graceful server shutdowns and tests to release Chromium deterministically. */
export async function closePdfBrowser() {
  clearIdleTimer();
  const instance = browser;
  if (instance) await forceClose(instance);
}

export const pdfServiceConfig = config;
