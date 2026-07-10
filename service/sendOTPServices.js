import { Resend } from "resend";
import OTP from "../models/otpModel.js";

const resend = new Resend(process.env.resendKey);

export async function sendEmail({
  to,
  subject,
  html,
  text,
  from = "CloudNest <otp@focskill.in>",
}) {
  if (!to) throw new Error("Recipient email is required");

  await resend.emails.send({
    from,
    to,
    subject,
    html,
    text,
  });

  return { success: true, message: "Email sent successfully" };
}

export async function sendOTPServices(email) {
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  console.log("email", email);

  await OTP.findOneAndUpdate(
    { email },
    { otp, createdAt: new Date() },
    { upsert: true },
  );

  const html = `
    <div style="font-family:sans-serif;">
      <h2>Your OTP is: ${otp}</h2>
      <p>This OTP is valid for 10 minutes.</p>
    </div>
  `;

  await sendEmail({
    to: email,
    subject: "CloudNest APP OTP",
    html,
  });

  return { success: true, message: "OTP sent successfully" };
} 