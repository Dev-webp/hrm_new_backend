import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
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
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text,
      attachments: pdf
        ? [
            {
              filename: filename || "letter.pdf",
              content: pdf,
              contentType: "application/pdf",
            },
          ]
        : [],
    });

    console.log("================================");
    console.log("✅ EMAIL SENT SUCCESSFULLY");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log("Message ID:", info.messageId);
    console.log("================================");

    return info;
  } catch (error) {
    console.error("================================");
    console.error("❌ EMAIL SEND FAILED");
    console.error(error);
    console.error("================================");
    throw error;
  }
}