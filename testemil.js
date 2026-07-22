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

async function sendMail() {
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: "your-email@example.com", // Replace with the recipient
      subject: "HRMS Test Email",
      text: "This is a test email from the HRMS application.",
    });

    console.log("Email sent successfully!");
    console.log("Message ID:", info.messageId);
  } catch (err) {
    console.error(err);
  }
}

sendMail();