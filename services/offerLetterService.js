import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { PDFDocument } from "pdf-lib";

import OfferLetterModel from "../models/offerLetterModel.js";
import { createCanonicalLetterPdf, emailCanonicalLetter, getCanonicalLetter, getCanonicalLetterById, renderCanonicalLetter, saveCanonicalLetter, setCanonicalLetterStatus } from "./canonicalLetterService.js";
import { previewLetter } from "./previewService.js";
import { resolveBranch } from "../utils/branchAddressService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PDF_TIMEOUT_MS = Number(
  process.env.PDF_TIMEOUT_MS || 60000
);

const MAX_CONCURRENT_PDF_JOBS = Number(
  process.env.MAX_CONCURRENT_PDF_JOBS || 1
);

const { readFile } = fs.promises;

let activePdfJobs = 0;

/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlText(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatCurrency(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return "";
  }

  const normalized = String(value).replace(/[₹,\s]/g, "");

  const amount = Number(normalized);

  if (!Number.isFinite(amount)) {
    return htmlText(
      String(value).replace(/₹/g, "").trim()
    );
  }

  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function normalizeSalaryWords(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+only\s*$/i, "")
    .trim();
}

/* =========================================================
   PLACEHOLDER VALUES
========================================================= */

function buildReplacements(offer) {
  const branch = resolveBranch(offer.branch);

  return {
    BRANCH_ADDRESS: branch.address,

    CANDIDATE_NAME: htmlText(offer.candidate_name),

    EMPLOYEE_NAME: htmlText(offer.candidate_name),

    CANDIDATE_EMAIL: htmlText(offer.candidate_email),

    CANDIDATE_ADDRESS: htmlText(
      offer.candidate_address
    ),

    DESIGNATION: htmlText(offer.designation),

    DEPARTMENT: htmlText(offer.department),

    BRANCH: htmlText(branch.name),

    LOCATION: htmlText(
      branch.officeLocation
    ),

    OFFER_DATE: htmlText(
      formatDate(offer.offer_date)
    ),

    JOINING_DATE: htmlText(
      formatDate(offer.joining_date)
    ),

    JOINING_TIME: htmlText(
      offer.joining_time || "10:00 AM"
    ),

    JOB_TITLE: htmlText(
      offer.job_title || offer.designation
    ),

    JOB_DESCRIPTION: htmlText(
      offer.job_description
    ),

    OFFICE_LOCATION: htmlText(
      branch.officeLocation
    ),

    SALARY: formatCurrency(offer.salary),

    SALARY_IN_WORDS: htmlText(
      normalizeSalaryWords(
        offer.salary_in_words
      )
    ),

    CTC: formatCurrency(offer.ctc),

    REPORTING_MANAGER: htmlText(
      offer.reporting_manager
    ),

    REFERENCE_NUMBER: htmlText(
      offer.reference_number
    ),
  };
}

/* =========================================================
   PLACEHOLDER REPLACEMENT
========================================================= */

function replacePlaceholders(html, offer) {
  const replacements = buildReplacements(offer);

  const found = new Set();

  const output = html.replace(
    /{{\s*([A-Za-z0-9_]+)\s*}}/g,

    (match, key) => {
      const normalizedKey = key.toUpperCase();

      found.add(normalizedKey);

      if (
        Object.prototype.hasOwnProperty.call(
          replacements,
          normalizedKey
        )
      ) {
        return replacements[normalizedKey];
      }

      return match;
    }
  );

  const unresolved = [
    ...new Set(
      output.match(
        /{{\s*[A-Za-z0-9_]+\s*}}/g
      ) || []
    ),
  ];

  console.log("[OFFER_PLACEHOLDERS]", {
    offerId: offer.id,

    found: [...found],

    unresolved,
  });

  if (unresolved.length > 0) {
    const error = new Error(
      `Template contains unresolved placeholders: ${unresolved.join(
        ", "
      )}`
    );

    error.statusCode = 500;

    throw error;
  }

  return output;
}

/* =========================================================
   PRINT CSS

   IMPORTANT:

   NO WRAPPERS.
   NO SCALE.
   NO TRANSFORM.
   NO ABSOLUTE REPOSITIONING OF .page.
========================================================= */

function injectPrintCss(html) {
  const css = `
<style id="offer-letter-print-css">

@page {
  size: 1059.40625px 1500.578125px;
  margin: 0;
}

html,
body {
  margin: 0 !important;
  padding: 0 !important;

  background: white !important;

  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

#page-container {
  position: static !important;

  margin: 0 !important;
  padding: 0 !important;

  width: 1059.40625px !important;
  height: auto !important;

  overflow: visible !important;

  background: white !important;
}

@media print {

  .page {
    position: relative !important;

    width: 1059.40625px !important;
    height: 1500.578125px !important;

    min-width: 1059.40625px !important;
    max-width: 1059.40625px !important;

    min-height: 1500.578125px !important;
    max-height: 1500.578125px !important;

    margin: 0 !important;
    padding: 0 !important;

    border: 0 !important;
    box-shadow: none !important;

    overflow: hidden !important;

    break-before: auto !important;
    page-break-before: auto !important;

    break-after: page !important;
    page-break-after: always !important;

    /*
     * IMPORTANT:
     * Keep AUTO.
     * Do not change this back to AVOID.
     */
    break-inside: auto !important;
    page-break-inside: auto !important;
  }

  .page:last-child {
    break-after: auto !important;
    page-break-after: auto !important;
  }


  /*
   * ======================================================
   * PAGE 1 HEADER FONT CONSISTENCY FIX
   * ======================================================
   *
   * PDFcrowd generated the header using several different
   * embedded font subsets.
   *
   * Do NOT use font-weight: bold on all .t elements.
   *
   * font-synthesis allows Chromium to synthesize missing
   * bold weights when the embedded subset does not contain
   * the requested weight.
   */

  #page1 .t {
    opacity: 1 !important;

    -webkit-text-fill-color: currentColor !important;

    font-synthesis: weight !important;

    text-rendering: geometricPrecision !important;
  }


  /*
   * Strengthen ONLY text that is already bold.
   *
   * This avoids making the complete document bold.
   */

  #page1 .t[style*="font-weight:bold"],
  #page1 .t[style*="font-weight: bold"],
  #page1 .t[style*="font-weight:700"],
  #page1 .t[style*="font-weight: 700"],
  #page1 b,
  #page1 strong {

    font-weight: 700 !important;

    text-shadow:
      0.12px 0 0 currentColor,
     -0.12px 0 0 currentColor,
      0 0.12px 0 currentColor,
      0 -0.12px 0 currentColor !important;
  }
}

</style>
`;

  if (html.includes("</head>")) {
    return html.replace(
      "</head>",
      `${css}</head>`
    );
  }

  return `${css}${html}`;
}

async function getCurrentOffer(id) {
  const result = await OfferLetterModel.findById(id);
  if (!result?.rows?.length) {
    const error = new Error("Offer letter not found");
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

async function renderOfferHtml(offer) {
  const templatePath = path.resolve(process.cwd(), "templates", "offerLetterTemplate.html");
  const template = await readFile(templatePath, "utf8");
  return injectPrintCss(replacePlaceholders(template, offer));
}

async function generatePdfBuffer(offer) {
  if (activePdfJobs >= MAX_CONCURRENT_PDF_JOBS) {
    const error = new Error(
      "PDF generation is busy. Please try again shortly."
    );

    error.statusCode = 429;
    throw error;
  }

  activePdfJobs += 1;

  let browser = null;
  let page = null;

  try {
    const html = await renderOfferHtml(offer);

    /* -----------------------------------------
       LAUNCH CHROME ONCE
    ----------------------------------------- */

    browser = await puppeteer.launch({
      headless: true,

      protocolTimeout:
        PDF_TIMEOUT_MS + 10000,

      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
      ],
    });

    /* -----------------------------------------
       CREATE PAGE ONCE
    ----------------------------------------- */

    page = await browser.newPage();

    page.setDefaultTimeout(PDF_TIMEOUT_MS);

    page.setDefaultNavigationTimeout(
      PDF_TIMEOUT_MS
    );

    /* -----------------------------------------
       LOAD HTML ONCE
    ----------------------------------------- */

    await page.setContent(html, {
      waitUntil: "load",
      timeout: PDF_TIMEOUT_MS,
    });

    await page.emulateMediaType("print");

    /* -----------------------------------------
       WAIT FOR FONTS AND IMAGES
    ----------------------------------------- */

await page.evaluate(async () => {
  // This callback runs INSIDE Chromium.

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const images = [...document.images];

  await Promise.all(
    images.map((image) => {
      if (image.complete) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        image.addEventListener("load", resolve, {
          once: true,
        });

        image.addEventListener("error", resolve, {
          once: true,
        });
      });
    })
  );
});

const headerFontAudit = await page.evaluate(() => {
  return [...document.querySelectorAll("#page1 .t")]
    .map((el, index) => {
      const style = window.getComputedStyle(el);

      return {
        index,

        text: (el.innerText || "")
          .replace(/\s+/g, " ")
          .trim(),

        classes:
          typeof el.className === "string"
            ? el.className
            : "",

        fontFamily: style.fontFamily,

        fontWeight: style.fontWeight,

        fontStyle: style.fontStyle,

        fontSize: style.fontSize,

        color: style.color,

        textShadow: style.textShadow,

        opacity: style.opacity,
      };
    })
    .filter((item) => item.text);
});

console.log(
  "[PAGE1_FONT_AUDIT]",
  JSON.stringify(headerFontAudit, null, 2)
);

    /* -----------------------------------------
       TEMPLATE DIAGNOSTICS
    ----------------------------------------- */

    const diagnostics = await page.evaluate(() => {
      const pages = [
        ...document.querySelectorAll(".page"),
      ];

      const unresolvedPlaceholders = [
        ...new Set(
          document.documentElement.innerHTML.match(
            /{{\s*[A-Za-z0-9_]+\s*}}/g
          ) || []
        ),
      ];

      return {
        pageCount: pages.length,

        unresolvedPlaceholders,

        pages: pages.map((element, index) => {
          const rect =
            element.getBoundingClientRect();

          const style =
            window.getComputedStyle(element);

          return {
            page: index + 1,

            id: element.id || null,

            width: rect.width,

            height: rect.height,

            scrollWidth: element.scrollWidth,

            scrollHeight: element.scrollHeight,

            overflow: style.overflow,

            transform: style.transform,

            breakBefore: style.breakBefore,

            breakAfter: style.breakAfter,

            pageBreakBefore:
              style.pageBreakBefore,

            pageBreakAfter:
              style.pageBreakAfter,
          };
        }),
      };
    });

    console.log(
      "[OFFER_TEMPLATE_DIAGNOSTICS]",
      JSON.stringify(diagnostics, null, 2)
    );

    if (!diagnostics.pageCount) {
      throw new Error(
        "Offer letter template contains no .page elements"
      );
    }

    if (
      diagnostics.unresolvedPlaceholders.length
    ) {
      throw new Error(
        `Unresolved placeholders: ${diagnostics.unresolvedPlaceholders.join(
          ", "
        )}`
      );
    }

    /* -----------------------------------------
       OVERFLOW DIAGNOSTICS
    ----------------------------------------- */

    const overflowPages =
      diagnostics.pages.filter(
        (item) =>
          item.scrollHeight >
            Math.ceil(item.height) + 2 ||
          item.scrollWidth >
            Math.ceil(item.width) + 2
      );

    if (overflowPages.length) {
      console.warn(
        "[OFFER_TEMPLATE_OVERFLOW]",
        overflowPages
      );
    }

    console.log("I AM PDF SERVICE");
console.log("OFFER SERVICE");

    const pdfBuffer = await page.pdf({

  width: "1059.40625px",
  height: "1500.578125px",

  printBackground: true,

  preferCSSPageSize: true,

  scale: 1,

  margin: {
    top: "0px",
    right: "0px",
    bottom: "0px",
    left: "0px",
  },
    });

const generatedPdf = await PDFDocument.load(pdfBuffer);

const generatedPdfPageCount =
  generatedPdf.getPageCount();

console.log("[GENERATED_PDF_PAGE_COUNT]", {
  offerId: offer.id,
  htmlPages: diagnostics.pageCount,
  pdfPages: generatedPdfPageCount,
});

if (
  generatedPdfPageCount !==
  diagnostics.pageCount
) {
  throw new Error(
    `PDF pagination mismatch: HTML has ${diagnostics.pageCount} pages but generated PDF has ${generatedPdfPageCount} pages`
  );
}

    if (!pdfBuffer.length) {
      throw new Error(
        "Puppeteer generated an empty PDF"
      );
    }

    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error("[PDF_GENERATE_FAILED]", {
      offerId: offer.id,

      message: error.message,

      stack: error.stack,
    });

    throw error;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }

    if (browser) {
      await browser.close().catch(() => {});
    }

    activePdfJobs = Math.max(
      0,
      activePdfJobs - 1
    );
  }
}

/* =========================================================
   SERVICE
========================================================= */

const OfferLetterService = {
  async createOffer(data) {
    await previewLetter("OFFER", data);
    return { rows: [await saveCanonicalLetter("OFFER", data, data.created_by)] };
  },

  async getAllOffers() { const offer = await getCanonicalLetter("OFFER"); return { rows: offer ? [offer] : [] }; },
  async getOfferById(id) { const offer = await getCanonicalLetterById("OFFER", id); return { rows: offer ? [offer] : [] }; },
  async updateOffer(id, data) {
    const current = await getCanonicalLetterById("OFFER", id);
    if (!current) return { rows: [] };
    const next = { ...current, ...data };
    await previewLetter("OFFER", next);
    return { rows: [await saveCanonicalLetter("OFFER", next, current.created_by)] };
  },
  async acceptOffer(id) {
    const offer = await getCanonicalLetterById("OFFER", id);
    return { rows: offer ? [await setCanonicalLetterStatus("OFFER", "ACCEPTED")] : [] };
  },

  async renderOfferHtmlById(id) {
    const offer = await getCanonicalLetterById("OFFER", id);
    if (!offer) { const error = new Error("Offer letter not found"); error.statusCode = 404; throw error; }
    return renderCanonicalLetter("OFFER", offer);
  },

  async generatePdfBuffer(id) {
    const offer = await getCanonicalLetterById("OFFER", id);
    if (!offer) { const error = new Error("Offer letter not found"); error.statusCode = 404; throw error; }
    return { offer, pdfBuffer: await createCanonicalLetterPdf("OFFER", offer) };
  },

  createPdfFilename(offer) {
    const candidate = String(offer.candidate_name || "candidate")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "candidate";
    return `offer-letter-${candidate}-${offer.id}.pdf`;
  },

  async sendOfferEmail(id) {
    const offer = await getCanonicalLetterById("OFFER", id);
    if (!offer) { const error = new Error("Offer letter not found"); error.statusCode = 404; throw error; }
    await emailCanonicalLetter("OFFER", {
      to: offer.recipient_email || offer.candidate_email,
      subject: `Offer Letter - ${offer.candidate_name || "Candidate"}`,
      text: "Please find your offer letter attached.",
      userId: offer.updated_by || offer.created_by,
    });
    return { rows: [await setCanonicalLetterStatus("OFFER", "SENT")] };
  },
};

export { replacePlaceholders, injectPrintCss };
export default OfferLetterService;
