import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import {
  replacePlaceholders,
  injectPrintCss,
} from "../services/offerLetterService.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const templatePath = path.join(backendRoot, "templates", "offerLetterTemplate.html");
const outputDir = path.join(backendRoot, "test-outputs", "offer-letter");

const testOffer = {
  id: "template-audit",
  candidate_name: "Aarav O'Connor & Sons <QA>",
  candidate_email: "aarav.o'connor+offer@example.test",
  candidate_address: "42 & 44, Baker's Lane\nIndiranagar, Bengaluru – 560038",
  designation: "Senior Platform Engineer",
  department: "Engineering & Product",
  offer_date: "2026-07-11",
  joining_date: "2026-08-03",
  joining_time: "09:45 AM",
  job_title: "Lead Full-Stack Engineer",
  job_description: "Owns secure employee-platform integrations.",
  office_location: "Koramangala – Bengaluru, Karnataka",
  salary: "₹1,234,567.5",
  salary_in_words: "Twelve lakh thirty-four thousand five hundred sixty-seven rupees and fifty paise",
  ctc: "2400000",
  branch: "Bangalore",
  location: "Koramangala, Bengaluru",
  reporting_manager: "Priya N. Rao",
  reference_number: "VJC/OL/2026/0711-A",
};

const optionalFieldsEmpty = {
  ...testOffer,
  id: "template-audit-optional-empty",
  candidate_address: "",
  job_description: "",
  reporting_manager: "",
  ctc: "",
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}


async function auditPage1Fonts(page, name) {
  const report = await page.evaluate(() => {
    return [...document.querySelectorAll("#page1 .t")]
      .map((element) => {
        const style = getComputedStyle(element);

        return {
          text: element.innerText.trim(),
          className: element.className,
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          fontSize: style.fontSize,
          color: style.color,
        };
      })
      .filter((item) => item.text);
  });

  console.log(`\n[PAGE1_FONT_AUDIT] ${name}`);

  console.table(report);

  return report;
}


async function render(name, offer, browser) {
  const template = await readFile(templatePath, "utf8");

const replacedHtml = replacePlaceholders(template, offer);
const html = injectPrintCss(replacedHtml);


  assert(!/{{\s*[A-Za-z0-9_]+\s*}}/.test(html), `${name}: unresolved placeholder`);
  assert(!html.includes("₹₹"), `${name}: doubled currency symbol`);
  assert(!html.includes("null") && !html.includes("undefined"), `${name}: nullish text rendered`);

  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
 await page.setContent(html, {
  waitUntil: ["load", "networkidle0"],
});


await page.evaluate(() => {
  const address = document.querySelector("#page1 .t.x1.h3.y2");

  if (!address) {
    console.warn("[ADDRESS_FONT_FIX] Address element not found");
    return;
  }

  // Force font on parent.
  address.style.setProperty(
    "font-family",
    "Arial, Helvetica, sans-serif",
    "important"
  );

  address.style.setProperty(
    "font-weight",
    "700",
    "important"
  );

  address.style.setProperty(
    "font-style",
    "normal",
    "important"
  );

  address.style.setProperty(
    "text-shadow",
    "none",
    "important"
  );

  // Force same font on every nested element.
  address.querySelectorAll("*").forEach((child) => {
    child.style.setProperty(
      "font-family",
      "Arial, Helvetica, sans-serif",
      "important"
    );

    child.style.setProperty(
      "font-weight",
      "700",
      "important"
    );

    child.style.setProperty(
      "font-style",
      "normal",
      "important"
    );

    child.style.setProperty(
      "text-shadow",
      "none",
      "important"
    );
  });

  console.log(
    "[ADDRESS_FONT_FIX_APPLIED]",
    address.innerText
  );
});

const addressFontAudit = await page.evaluate(() => {
  const address = document.querySelector("#page1 .t.x1.h3.y2");

  if (!address) {
    return {
      found: false,
    };
  }

  return {
    found: true,

    parent: {
      fontFamily: getComputedStyle(address).fontFamily,
      fontWeight: getComputedStyle(address).fontWeight,
    },

    children: Array.from(address.querySelectorAll("*")).map(
      (el, index) => ({
        index,
        text: el.textContent,
        classes: el.className,
        fontFamily: getComputedStyle(el).fontFamily,
        fontWeight: getComputedStyle(el).fontWeight,
      })
    ),
  };
});

console.log(
  "[ADDRESS_FONT_AUDIT]",
  JSON.stringify(addressFontAudit, null, 2)
);

await page.emulateMediaType("print");

// IMPORTANT: wait until embedded fonts are fully decoded and loaded
await page.evaluate(async () => {
  await document.fonts.ready;
});


const fontReport = await auditPage1Fonts(page, name);

await writeFile(
  path.join(outputDir, `${name}-font-report.json`),
  JSON.stringify(fontReport, null, 2),
  "utf8"
);


  const bodyText = await page.evaluate(() => document.body.innerText);
  assert(bodyText.includes("₹12,34,567.50"), `${name}: salary was not Indian-formatted`);
  assert(bodyText.includes("₹24,00,000.00") || name.includes("optional"), `${name}: CTC was not Indian-formatted`);
  assert((bodyText.match(/Phone Number/g) || []).length === 1, `${name}: duplicated phone number`);
  assert((bodyText.match(/website/g) || []).length === 1, `${name}: duplicated website`);

console.log("I AM PDF SERVICE");

  const pdfPath = path.join(outputDir, `${name}.pdf`);
  await page.pdf({
    path: pdfPath,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
  await page.screenshot({
    path: path.join(outputDir, `${name}-header.png`),
    clip: { x: 0, y: 0, width: 794, height: 320 },
  });
 const detailsPage =
  await page.$("#page9");

if (detailsPage) {
  await detailsPage.screenshot({
    path: path.join(
      outputDir,
      `${name}-details-page.png`
    ),
  });
} else {
  console.warn(
    `[TEST_WARNING] ${name}: #page9 not found`
  );
}

  await page.close();

  return { pdfPath, bodyText };
}

await mkdir(outputDir, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
});

try {
  const populated = await render("all-fields-populated", testOffer, browser);
  await render("optional-fields-empty", optionalFieldsEmpty, browser);
  await writeFile(path.join(outputDir, "rendered-text.txt"), populated.bodyText, "utf8");
  console.log(JSON.stringify({ outputDir, primaryPdf: populated.pdfPath }, null, 2));
} finally {
  await browser.close();
}
