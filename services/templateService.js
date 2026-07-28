import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { renderPlaceholders } from "../utils/placeholderService.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const files = {
  OFFER: "offerLetterTemplate.html",
  EXPERIENCE_RELIEVING: "experienceRelievingTemplate.html",
};

// Cache templates in memory
const templateCache = new Map();

export async function renderLetterHtml(letterType, values) {
  const timing = `[LETTER_PERF][${letterType}]`;
  console.time(`${timing} template-and-placeholders`);
  let template = templateCache.get(letterType);

  if (!template) {
    console.log(
      `[TEMPLATE CACHE] Loading ${letterType} template from disk...`
    );

    console.time(`${timing} template-read`);
    try {
      template = await readFile(
        path.join(root, "templates", files[letterType]),
        "utf8"
      );
    } finally {
      console.timeEnd(`${timing} template-read`);
    }

    if (!template.trim()) {
      throw Object.assign(
        new Error("Letter template is not available"),
        { statusCode: 503 }
      );
    }

    templateCache.set(letterType, template);
  }

  console.time(`${timing} placeholder-replacement`);
  try {
    return renderPlaceholders(
      template,
      {
        ...values,
        branch: values.branch || values.employee_branch,
      },
      letterType
    );
  } finally {
    console.timeEnd(`${timing} placeholder-replacement`);
    console.timeEnd(`${timing} template-and-placeholders`);
  }
}
