import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";

import OfferLetterModel from "../models/offerLetterModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PDF_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS || 30000);
const MAX_CONCURRENT_PDF_JOBS = Number(process.env.MAX_CONCURRENT_PDF_JOBS || 1);
const { readFile, writeFile, mkdir } = fs.promises;
let activePdfJobs = 0;

const BRANCH_ADDRESSES = {
  Bangalore: `VJC OVERSEAS<br/>
Raheja Arcade, 16 & 17, 5th Block,<br/>
Opp. Nexus Mall, Koramangala,<br/>
Bengaluru, Karnataka - 560095<br/>
Phone Number :+91 9440467000 /+91 8970567999<br/>
Email Id : info@vjcoverseas.com<br/>
website : www.vjcoverseas.com`,

  Hyderabad: `VJC IMMIGRATION & VISA CONSULTANTS PVT. LTD.<br/>
Registered Office: 62/A, Sundari Reddy Bhavan, Ground Floor,<br/>
Vengalrao Nagar, S.R.Nagar,<br/>
Hyderabad, Telangana - 500038<br/>
Phone Number :+91 9440467000 /+91 8970567999<br/>
Email Id : info@vjcoverseas.com<br/>
website : www.vjcoverseas.com`,
};

function getBranchAddress(branch) {
  return BRANCH_ADDRESSES[branch] || BRANCH_ADDRESSES.Hyderabad;
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function replacePlaceholders(html, offer) {
  const replacements = {
    BRANCH_ADDRESS: getBranchAddress(offer.branch),

    CANDIDATE_NAME: offer.candidate_name || "",
    CANDIDATE_EMAIL: offer.candidate_email || "",
    CANDIDATE_ADDRESS: offer.candidate_address || "",

    DESIGNATION: offer.designation || "",
    DEPARTMENT: offer.department || "",

    BRANCH: offer.branch || "",
    LOCATION: offer.location || offer.branch || "",

    OFFER_DATE: formatDate(offer.offer_date),
    JOINING_DATE: formatDate(offer.joining_date),

    SALARY: offer.salary || "",
    CTC: offer.ctc || "",

    REPORTING_MANAGER: offer.reporting_manager || "",
    REFERENCE_NUMBER: offer.reference_number || "",
  };

  return html.replace(/{{(.*?)}}/g, (match, key) => {
    return replacements[key.trim()] ?? "";
  });
}

const OfferLetterService = {
  async createOffer(data) {
    return await OfferLetterModel.create(data);
  },

  async getAllOffers() {
    return await OfferLetterModel.findAll();
  },

  async getOfferById(id) {
    return await OfferLetterModel.findById(id);
  },

  async sendOffer(id) {
    return await OfferLetterModel.updateStatus(id, "SENT");
  },

  async acceptOffer(id) {
    return await OfferLetterModel.updateStatus(id, "ACCEPTED");
  },

  async generatePdf(id) {
    if (activePdfJobs >= MAX_CONCURRENT_PDF_JOBS) {
      const err = new Error("PDF generation is busy. Please try again shortly.");
      err.statusCode = 429;
      throw err;
    }

    activePdfJobs += 1;
    let browser;

    try {
      const result = await OfferLetterModel.findById(id);

      if (result.rows.length === 0) {
        const err = new Error("Offer letter not found");
        err.statusCode = 404;
        throw err;
      }

      const offer = result.rows[0];

      const templatePath = path.resolve(
        process.cwd(),
        "templates",
        "offerLetterTemplate.html"
      );

      let html = await readFile(templatePath, "utf8");

      html = replacePlaceholders(html, offer);

      const uploadDir = path.join(__dirname, "../uploads/offer-letters");

      await mkdir(uploadDir, { recursive: true });

      const fileName = `offer-letter-${offer.id}-${Date.now()}.pdf`;
      const filePath = path.join(uploadDir, fileName);

      const debugPath = path.join(
        __dirname,
        "../uploads/debug-offer-letter.html"
      );

      if (process.env.NODE_ENV !== "production") {
        await writeFile(debugPath, html);
      }
      console.log("[PDF_GENERATE_START]", { offerId: id, fileName });

      browser = await puppeteer.launch({
        headless: true,
        protocolTimeout: PDF_TIMEOUT_MS + 10000,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--font-render-hinting=none",
          "--no-first-run",
          "--no-zygote",
        ],
      });

      const page = await browser.newPage();
      page.setDefaultTimeout(PDF_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(PDF_TIMEOUT_MS);

      await page.setContent(html, {
        waitUntil: "domcontentloaded",
        timeout: PDF_TIMEOUT_MS,
      });

      await page.pdf({
        path: filePath,
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        timeout: PDF_TIMEOUT_MS,
        margin: {
          top: "0mm",
          right: "0mm",
          bottom: "0mm",
          left: "0mm",
        },
      });

      await page.close().catch(() => {});

      const pdfUrl = `/uploads/offer-letters/${fileName}`;

      await OfferLetterModel.updatePdfUrl(id, pdfUrl);
      console.log("[PDF_GENERATE_SUCCESS]", { offerId: id, pdfUrl });

      return {
        fileName,
        filePath,
        pdfUrl,
      };
    } catch (err) {
      console.error("[PDF_GENERATE_FAILED]", {
        offerId: id,
        message: err.message,
        stack: err.stack,
      });
      throw err;
    } finally {
      if (browser) {
        await browser.close().catch((closeErr) => {
          console.error("[PDF_BROWSER_CLOSE_FAILED]", closeErr);
        });
      }
      activePdfJobs = Math.max(0, activePdfJobs - 1);
    }
  },
};

export default OfferLetterService;
