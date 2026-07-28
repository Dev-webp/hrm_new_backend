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

console.time("MAIL");

const info = await transporter.sendMail({
  from: process.env.SMTP_FROM,
  to: process.env.SMTP_USER, // or your test email
  subject: "Test",
  text: "Hello",
});

console.timeEnd("MAIL");

console.log("Email sent successfully!");
console.log("Message ID:", info.messageId);