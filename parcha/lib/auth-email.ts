import "server-only"

import { Resend } from "resend"

import { requiredServerSetting } from "@/lib/server-env"

function safeUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("Authentication email URL must use HTTPS")
  }
  return url.toString()
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

async function sendAuthEmail({
  to,
  subject,
  intro,
  action,
  url,
}: {
  to: string
  subject: string
  intro: string
  action: string
  url: string
}) {
  const link = safeUrl(url)
  const htmlLink = escapeHtml(link)
  const resend = new Resend(requiredServerSetting("RESEND_API_KEY"))
  const { error } = await resend.emails.send({
    from: requiredServerSetting("AUTH_EMAIL_FROM"),
    to,
    subject,
    text: `${intro}\n\n${action}: ${link}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    html: `<div style="background:#0a0a0a;color:#f0ede6;font-family:Arial,sans-serif;padding:32px"><p style="color:#8ebeff;font-family:monospace;font-size:12px;letter-spacing:.12em">LEX ARCHIVES</p><h1 style="font-size:24px">${subject}</h1><p style="color:#aaa">${intro}</p><p style="margin:28px 0"><a href="${htmlLink}" style="background:#78aef8;color:#090909;padding:12px 18px;text-decoration:none;font-weight:700">${action}</a></p><p style="color:#777;font-size:12px">This link expires in one hour. If you did not request it, you can ignore this email.</p></div>`,
  })
  if (error) throw new Error(`Resend rejected the authentication email: ${error.message}`)
}

export function sendVerificationEmail(to: string, url: string) {
  return sendAuthEmail({
    to,
    url,
    subject: "Verify your Lex Archives email",
    intro: "Confirm this address to activate your research workspace.",
    action: "Verify email",
  })
}

export function sendPasswordResetEmail(to: string, url: string) {
  return sendAuthEmail({
    to,
    url,
    subject: "Reset your Lex Archives password",
    intro: "A password reset was requested for your account.",
    action: "Reset password",
  })
}
