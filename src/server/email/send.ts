import React from "react";
import { render } from "@react-email/render";
import { getResend, FROM, REPLY_TO } from "./client";
import { VerifyEmail } from "./templates/VerifyEmail";
import { ResetPassword } from "./templates/ResetPassword";

export async function sendVerificationEmail(to: string, verifyUrl: string) {
  const html = await render(React.createElement(VerifyEmail, { verifyUrl }));
  const resend = getResend();
  await resend.emails.send({
    from: FROM,
    replyTo: REPLY_TO ?? undefined,
    to,
    subject: "Verify your Launchstack email",
    html,
  });
}

export async function sendResetPasswordEmail(to: string, resetUrl: string) {
  const html = await render(React.createElement(ResetPassword, { resetUrl }));
  const resend = getResend();
  await resend.emails.send({
    from: FROM,
    replyTo: REPLY_TO ?? undefined,
    to,
    subject: "Reset your Launchstack password",
    html,
  });
}
