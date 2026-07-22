import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { renderPlaceholders } from "../utils/placeholderService.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = { OFFER: "offerLetterTemplate.html", EXPERIENCE_RELIEVING: "experienceRelievingTemplate.html" };
export async function renderLetterHtml(letterType, values) {
  const template = await readFile(path.join(root, "templates", files[letterType]), "utf8");
  if (!template.trim()) throw Object.assign(new Error("Letter template is not available"), { statusCode: 503 });
  return renderPlaceholders(template, { ...values, branch: values.branch || values.employee_branch }, letterType);
}
