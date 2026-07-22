import { createPdf } from "./pdfService.js";
import { sendLetterEmail } from "./emailService.js";
import { previewLetter } from "./previewService.js";
import {
  getCurrentRequest,
  logEmail,
  saveCurrentRequest,
  updateCurrentRequestStatus,
} from "./letterRequestService.js";


const values = (request) => {
  console.log("========== VALUES() ==========");
  console.log("REQUEST =", request);
  console.log("DOCUMENT_DATA =", request?.document_data);

  const result = {
    ...request,
    ...(request?.document_data || {}),
  };

  console.log("RESULT =", result);
  console.log("==============================");

  return result;
};


const notFound = () =>
  Object.assign(new Error("Letter not found"), { statusCode: 404 });

/**
 * Canonical, current-only Letter flow.
 * Both /api/letters and legacy offer compatibility endpoints use this service.
 * It never persists HTML or PDFs.
 */
export async function getCanonicalLetter(letterType) {
  const request = await getCurrentRequest(letterType);
  return request ? values(request) : null;
}

export async function getCanonicalLetterById(letterType, id) {
  const request = await getCanonicalLetter(letterType);
  return request && Number(request.id) === Number(id) ? request : null;
}

export async function saveCanonicalLetter(letterType, data, userId) {
  console.log("===== saveCanonicalLetter =====");
  console.log("letterType:", letterType);
  console.log("data:", data);
  console.log("userId:", userId);

  return values(await saveCurrentRequest(letterType, data, userId));
}

export async function renderCanonicalLetter(letterType, request = null) {
  const letter = request || (await getCanonicalLetter(letterType));

  if (!letter) throw notFound();

  console.log("========== PREVIEW DATA ==========");
  console.log(letter);
  console.log("designation =", letter.designation);
  console.log("department =", letter.department);
  console.log("joining_date =", letter.joining_date);
  console.log("document_data =", letter.document_data);
  console.log("=================================");

  return previewLetter(letterType, letter);
}

export async function createCanonicalLetterPdf(letterType, request = null) {
  const letter = request || (await getCanonicalLetter(letterType));

  if (!letter) throw notFound();

  console.log("========= DOWNLOAD LETTER =========");
  console.log(letter);
  console.log("designation =", letter.designation);
  console.log("department =", letter.department);
  console.log("joining_date =", letter.joining_date);
  console.log("document_data =", letter.document_data);
  console.log("===================================");

  const html = await renderCanonicalLetter(letterType, letter);

  return createPdf(html);
}

export async function setCanonicalLetterStatus(letterType, status) {
  const request = await updateCurrentRequestStatus(letterType, status);
  return values(request);
}

export async function emailCanonicalLetter(
  letterType,
  { to, subject, text, userId }
) {
  const request = await getCanonicalLetter(letterType);

  if (!request) throw notFound();

  const recipient = String(
    to ||
      request.recipient_email ||
      request.candidate_email ||
      ""
  ).trim();

  if (!recipient || !subject) {
    throw Object.assign(
      new Error("Recipient email and subject are required"),
      { statusCode: 400 }
    );
  }

  const pdf = await createCanonicalLetterPdf(letterType, request);

  try {
    await sendLetterEmail({
      to: recipient,
      subject,
      text: text || "",
      pdf,
      filename: `${letterType.toLowerCase()}-letter.pdf`,
    });

    await logEmail(request.id, {
      email: recipient,
      subject,
      status: "SENT",
      userId,
    });
  } catch (error) {
    await logEmail(request.id, {
      email: recipient,
      subject,
      status: "FAILED",
      error: error.message,
      userId,
    });

    throw error;
  }
}