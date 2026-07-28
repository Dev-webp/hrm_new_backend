import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",

  logger: true,
  debug: true,

  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});
transporter.verify((error) => {
  if (error) {
    console.error("❌ SMTP Connection Failed:", error.message);
  } else {
    console.log("✅ SMTP Server is ready to send emails");
  }
});

export async function sendLetterEmail({
  to,
  subject,
  text,
  pdf,
  filename,
}) {
  let smtpTimerStarted = false;
  try {
    console.time("[LETTER_PERF] attachment-preparation");
    const attachments = pdf
      ? [{
          filename: filename || "letter.pdf",
          content: pdf,
          contentType: "application/pdf",
        }]
      : [];
    console.timeEnd("[LETTER_PERF] attachment-preparation");

    console.info("[LETTER_PERF] attachment", {
      present: Boolean(pdf),
      bytes: pdf?.length || 0,
      attachmentCount: attachments.length,
    });

    // sendMail includes DNS, TCP/TLS, authentication, MIME encoding/upload,
    // and the server's final response. debug:true already emits timestamped
    // SMTP protocol events; this timer measures the full network transaction.
    console.time("[LETTER_PERF] smtp-sendMail-total");
    smtpTimerStarted = true;
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text,
      attachments,
    });
    console.timeEnd("[LETTER_PERF] smtp-sendMail-total");
    smtpTimerStarted = false;

    console.log("================================");
    console.log("✅ EMAIL SENT SUCCESSFULLY");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log("Message ID:", info.messageId);
    console.log("================================");

    return info;
  } catch (error) {
    // A failed send still needs a closed timer entry in the trace.
    if (smtpTimerStarted) console.timeEnd("[LETTER_PERF] smtp-sendMail-total");
    console.error("================================");
    console.error("❌ EMAIL SEND FAILED");
    console.error(error);
    console.error("================================");
    throw error;
  }
}
