import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";
import path from "path";
import { fileURLToPath } from "url";
import { readFile, writeFile, mkdir } from "fs/promises";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
let pdfJobSequence = 0;

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
  console.time("[LETTER_PERF] chromium-browser-close");
  try { await timeout(instance.close(), config.shutdownTimeoutMs, "BROWSER_SHUTDOWN_TIMEOUT", "Browser shutdown timed out."); }
  catch {
    try { instance.process()?.kill("SIGKILL"); } catch { /* best-effort process cleanup */ }
  } finally {
    console.timeEnd("[LETTER_PERF] chromium-browser-close");
    invalidateBrowser(instance);
  }
}

async function getBrowser(jobLabel) {
  console.log("PID:", process.pid);
  console.log("Browser exists:", !!browser);
  console.log("Browser connected:", browser?.connected);

  if (browser?.connected) {
    console.info("[LETTER_PERF] browser-reused", { job: jobLabel });
    console.log("♻️ Reusing existing browser");
    return browser;
  }

  if (!launchPromise) {
    console.log("🚀 Launching new browser");

    console.time(`${jobLabel} chromium-launch`);
    launchPromise = timeout(
      puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
        ],
      }),
      config.launchTimeoutMs,
      "BROWSER_LAUNCH_TIMEOUT",
      "Browser launch timed out."
    )
      .then((instance) => {
        browser = instance;

        const proc = instance.process();

if (proc) {
  console.log("🟢 Chromium launched:", proc.pid);

  proc.on("exit", (code, signal) => {
    console.log("🟥 Chromium process exited");
    console.log("Exit code:", code);
    console.log("Signal:", signal);
  });

  proc.on("error", (err) => {
    console.error("🟥 Chromium process error:", err);
  });
}

instance.once("disconnected", async () => {
  console.log("❌ Browser disconnected");

  try {
    console.log("Connected before disconnect:", instance.connected);
  } catch {}

  console.trace("Disconnect stack");

  invalidateBrowser(instance);
});
        return instance;
      })
      .finally(() => {
        console.timeEnd(`${jobLabel} chromium-launch`);
        launchPromise = null;
      });
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

async function verifyDocument(page, jobLabel) {
  console.time(`${jobLabel} image-verification`);

  let assets;

  try {
    assets = await page.evaluate(() => {
      const images = [...document.images].map(image => ({
        src: image.getAttribute("src") || "",
        complete: image.complete,
        width: image.naturalWidth,
        height: image.naturalHeight,
      }));

      return {
        readyState: document.readyState,
        stylesheets: document.styleSheets.length,
        fonts: document.fonts?.status || "unsupported",
        images,
      };
    });
  } finally {
    console.timeEnd(`${jobLabel} image-verification`);
  }

  const failedImages = assets.images.filter(
    image =>
      image.src &&
      (!image.complete ||
       image.width === 0 ||
       image.height === 0)
  );

  if (
    assets.readyState !== "complete" ||
    !assets.stylesheets ||
    assets.fonts === "loading"
  ) {
    throw new PdfGenerationError(
      "ASSET_VERIFICATION_FAILED",
      "Required document styles or fonts are unavailable."
    );
  }

  if (failedImages.length) {
    console.log("========== FAILED IMAGES ==========");
    console.table(failedImages);
    console.log("===================================");

    throw new PdfGenerationError(
      "ASSET_VERIFICATION_FAILED",
      "Required document assets are unavailable."
    );
  }

  return {
    imageCount: assets.images.length,
    fontStatus: assets.fonts,
  };
}


async function renderPdf(html, jobLabel) {
  if (!String(html || "").trim()) throw new PdfGenerationError("TEMPLATE_ERROR", "PDF HTML is empty.", { statusCode: 422 });
  if (/\{\{\s*[A-Za-z0-9_]+\s*\}\}/.test(html)) throw new PdfGenerationError("PLACEHOLDER_VALIDATION_ERROR", "PDF HTML contains unresolved placeholders.", { statusCode: 422 });
  const startedAt = now();
  const details = templateDetails(html);
  const launchStartedAt = now();
  const instance = await getBrowser(jobLabel);
  const browserLaunchDurationMs = duration(launchStartedAt);
  let page;
  try {
    const renderStartedAt = now();
    console.time(`${jobLabel} browser-new-page`);
    try {
      page = await timeout(
        instance.newPage(),
        config.renderTimeoutMs,
        "RENDER_TIMEOUT",
        "Page creation timed out."
      );
    } finally {
      console.timeEnd(`${jobLabel} browser-new-page`);
    }

    console.time(`${jobLabel} viewport-and-print-media`);
    try {
await page.setViewport({
    width:794,
    height:1123,
    deviceScaleFactor:1
});

      await page.emulateMediaType("print");
    } finally {
      console.timeEnd(`${jobLabel} viewport-and-print-media`);
    }

    console.time(`${jobLabel} set-content`);
    try {
      await timeout(
        page.setContent(html, { waitUntil: "domcontentloaded" }),
        config.renderTimeoutMs,
        "RENDER_TIMEOUT",
        "HTML rendering timed out."
      );
    } finally {
      console.timeEnd(`${jobLabel} set-content`);
    }










    
    console.time(`${jobLabel} font-loading`);
    try {
      await page.evaluate(async () => { await document.fonts.ready; });
    } finally {
      console.timeEnd(`${jobLabel} font-loading`);
    }


 

     
    console.time(`${jobLabel} document-verification`);
    let assets;
    try {
      assets = await timeout(verifyDocument(page, jobLabel), config.renderTimeoutMs, "RENDER_TIMEOUT", "Asset verification timed out.");
    } finally {
      console.timeEnd(`${jobLabel} document-verification`);
    }
    const renderDurationMs = duration(renderStartedAt);
    const pdfStartedAt = now();

    // Offer pages are fixed-size canvases. Printing them on A4 makes each
    // canvas overflow and split into an additional blank PDF page.
  
const pdfOptions = {
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  scale: 1,
  margin: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
};

// ---------------- PAGE METRICS ----------------
const pageMetrics = await page.evaluate(() => {
  const pageEl = document.querySelector(".page");

  if (!pageEl) return null;

  const rect = pageEl.getBoundingClientRect();

  return {
    width: rect.width,
    height: rect.height,
    clientWidth: pageEl.clientWidth,
    clientHeight: pageEl.clientHeight,
    scrollWidth: pageEl.scrollWidth,
    scrollHeight: pageEl.scrollHeight,
  };
});

console.log("========== PAGE METRICS ==========");
console.table(pageMetrics);
console.log("==================================");

// ---------------- GENERATE PDF ----------------
console.time(`${jobLabel} page-pdf`);

let pdf;

try {
  pdf = await timeout(
    page.pdf(pdfOptions),
    config.generationTimeoutMs,
    "PDF_TIMEOUT",
    "PDF generation timed out."
  );
} finally {
  console.timeEnd(`${jobLabel} page-pdf`);
}

if (!pdf || pdf.length === 0) {
  throw new PdfGenerationError(
    "PDF_GENERATION_FAILED",
    "Generated PDF is empty."
  );
}

// ---------------- CHECK PAGE COUNT ----------------
console.time(`${jobLabel} pdf-buffer-inspection`);

let pageCount;

try {
  const pdfDoc = await PDFDocument.load(pdf);
  pageCount = pdfDoc.getPageCount();
} finally {
  console.timeEnd(`${jobLabel} pdf-buffer-inspection`);
}

// ---------------- DIAGNOSTICS ----------------
console.info("[PDF_JOB_DIAGNOSTICS]", {
  ...details,
  placeholderCount:
    (html.match(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g) || []).length,
  browserLaunchDurationMs,
  renderDurationMs,
  pdfDurationMs: duration(pdfStartedAt),
  totalDurationMs: duration(startedAt),
  pageCount,
  generatedPdfBytes: pdf.length,
  imageCount: assets.imageCount,
  fontStatus: assets.fontStatus,
  memoryRssBytes: process.memoryUsage().rss,
});

// ---------------- RETURN BUFFER ----------------
// ---------------- RETURN BUFFER ----------------
console.time(`${jobLabel} buffer-conversion`);

try {
  return Buffer.from(pdf);
} finally {
  console.timeEnd(`${jobLabel} buffer-conversion`);
}

} catch (error) {
  if (error instanceof PdfGenerationError) {
    throw error;
  }

  throw new PdfGenerationError(
    "PDF_GENERATION_FAILED",
    "PDF generation failed.",
    { cause: error }
  );
} finally {
  if (page) {
    console.time(`${jobLabel} browser-page-close`);
    await page.close().catch(() => {});
    console.timeEnd(`${jobLabel} browser-page-close`);
  }
}
}


/** Generates an A4 PDF while reusing a managed Chromium instance. */
export function createPdf(html) {
  const jobLabel = `[LETTER_PERF][pdf-${++pdfJobSequence}]`;
  console.time(`${jobLabel} queue-wait`);
  return enqueue(() => {
    console.timeEnd(`${jobLabel} queue-wait`);
    return renderPdf(html, jobLabel);
  });
}

/** Allows graceful server shutdowns and tests to release Chromium deterministically. */
export async function closePdfBrowser() {
  clearIdleTimer();
  const instance = browser;
  if (instance) await forceClose(instance);
}

export const pdfServiceConfig = config;
