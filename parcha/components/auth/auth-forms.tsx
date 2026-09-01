"use client"

import { ArrowRight, LoaderCircle } from "lucide-react"
import Link from "next/link"
import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"

import { authClient } from "@/lib/auth-client"

import styles from "./auth.module.css"

function messageFor(error: { message?: string; status?: number; statusCode?: number } | null) {
  if (!error) return null
  if (error.status === 429 || error.statusCode === 429) {
    return "Too many attempts. Please wait a few minutes and try again."
  }
  return error.message || "Something went wrong. Please try again."
}

function SubmitButton({ busy, children }: { busy: boolean; children: string }) {
  return (
    <button type="submit" className={styles.primaryButton} disabled={busy}>
      {busy ? <LoaderCircle size={16} className={styles.spinner} /> : null}
      {busy ? "Please wait" : children}
      {!busy ? <ArrowRight size={16} /> : null}
    </button>
  )
}

function GoogleButton({ callbackURL }: { callbackURL: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
    setBusy(true)
    setError(null)
    const result = await authClient.signIn.social({ provider: "google", callbackURL })
    if (result?.error) {
      setError(messageFor(result.error))
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={styles.googleButton} onClick={signIn} disabled={busy}>
        <span className={styles.googleMark}>G</span>
        {busy ? "Connecting…" : "Continue with Google"}
      </button>
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
      <div className={styles.divider}><span>OR</span></div>
    </>
  )
}

export function SignInForm({ callbackURL, googleEnabled }: { callbackURL: string; googleEnabled: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    const result = await authClient.signIn.email({
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
      callbackURL,
    })
    if (result.error) {
      setError(messageFor(result.error))
      setBusy(false)
      return
    }
    router.push(callbackURL)
    router.refresh()
  }

  return (
    <>
      {googleEnabled ? <GoogleButton callbackURL={callbackURL} /> : null}
      <form className={styles.form} onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>
          <span className={styles.labelRow}>Password <Link href="/forgot-password">Forgot password?</Link></span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error ? <p className={styles.formError} role="alert">{error}</p> : null}
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
    </>
  )
}

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const submittedEmail = String(form.get("email") || "").trim()
    const password = String(form.get("password") || "")
    const confirmation = String(form.get("confirmPassword") || "")
    if (password !== confirmation) {
      setError("Passwords do not match.")
      return
    }
    if (password.length < 12 || password.length > 128) {
      setError("Use a password between 12 and 128 characters.")
      return
    }

    setBusy(true)
    setError(null)
    const result = await authClient.signUp.email({
      name: String(form.get("name") || "").trim(),
      email: submittedEmail,
      password,
      callbackURL: "/verify-email?verified=true",
    })
    if (result.error?.status === 429) {
      setError(messageFor(result.error))
      setBusy(false)
      return
    }
    if (result.error) {
      setError(messageFor(result.error))
      setBusy(false)
      return
    }
    setEmail(submittedEmail)
    setComplete(true)
    setBusy(false)
  }

  if (complete) {
    return (
      <div className={styles.notice}>
        <strong>Check your inbox</strong>
        <p>If an account can be created for <span>{email}</span>, a one-hour verification link is on its way.</p>
        <Link href={`/verify-email?email=${encodeURIComponent(email)}`}>Verification help <ArrowRight size={14} /></Link>
      </div>
    )
  }

  return (
    <>
      {googleEnabled ? <GoogleButton callbackURL="/research" /> : null}
      <form className={styles.form} onSubmit={submit}>
      <label>Name<input name="name" autoComplete="name" minLength={2} maxLength={80} required /></label>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><small>12–128 characters</small></label>
      <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
      <SubmitButton busy={busy}>Create account</SubmitButton>
      </form>
    </>
  )
}

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    const result = await authClient.requestPasswordReset({
      email: String(form.get("email") || ""),
      redirectTo: "/reset-password",
    })
    if (result.error?.status === 429) {
      setError(messageFor(result.error))
      setBusy(false)
      return
    }
    setComplete(true)
    setBusy(false)
  }

  if (complete) {
    return <div className={styles.notice}><strong>Check your inbox</strong><p>If that address belongs to an account, a one-hour reset link has been sent.</p></div>
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
      <SubmitButton busy={busy}>Send reset link</SubmitButton>
    </form>
  )
}

export function ResetPasswordForm({ token, invalid }: { token?: string; invalid: boolean }) {
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<string | null>(
    invalid || !token ? "This reset link is invalid or has expired." : null
  )

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    const form = new FormData(event.currentTarget)
    const password = String(form.get("password") || "")
    const confirmation = String(form.get("confirmPassword") || "")
    if (password !== confirmation) {
      setError("Passwords do not match.")
      return
    }
    if (password.length < 12 || password.length > 128) {
      setError("Use a password between 12 and 128 characters.")
      return
    }
    setBusy(true)
    setError(null)
    const result = await authClient.resetPassword({ newPassword: password, token })
    if (result.error) {
      setError(messageFor(result.error))
      setBusy(false)
      return
    }
    setComplete(true)
    setBusy(false)
  }

  if (complete) {
    return <div className={styles.notice}><strong>Password updated</strong><p>All existing sessions have been revoked. Sign in again with your new password.</p><Link href="/sign-in">Sign in <ArrowRight size={14} /></Link></div>
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} disabled={!token || invalid} required /><small>12–128 characters</small></label>
      <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} disabled={!token || invalid} required /></label>
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
      <SubmitButton busy={busy || !token || invalid}>Set new password</SubmitButton>
    </form>
  )
}

export function VerifyEmailForm({ initialEmail, verified, errorCode }: { initialEmail: string; verified: boolean; errorCode?: string }) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    const result = await authClient.sendVerificationEmail({
      email: String(form.get("email") || ""),
      callbackURL: "/verify-email?verified=true",
    })
    if (result.error?.status === 429) {
      setError(messageFor(result.error))
      setBusy(false)
      return
    }
    setSent(true)
    setBusy(false)
  }

  if (verified) {
    return <div className={styles.notice}><strong>Email verified</strong><p>Your account is active. Sign in to enter the research workspace.</p><Link href="/sign-in?callbackURL=/research">Continue to sign in <ArrowRight size={14} /></Link></div>
  }

  return (
    <>
      {errorCode ? <p className={styles.formError} role="alert">That verification link is invalid, expired, or has already been used.</p> : null}
      {sent ? <div className={styles.notice}><strong>Check your inbox</strong><p>If the address has an unverified account, a fresh verification link has been sent.</p></div> : (
        <form className={styles.form} onSubmit={submit}>
          <label>Email<input name="email" type="email" defaultValue={initialEmail} autoComplete="email" required /></label>
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          <SubmitButton busy={busy}>Resend verification</SubmitButton>
        </form>
      )}
    </>
  )
}

export function AccountActions() {
  const router = useRouter()
  const [busy, setBusy] = useState<"current" | "all" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const signOut = async () => {
    setBusy("current")
    setError(null)
    const result = await authClient.signOut()
    if (result.error) {
      setError(messageFor(result.error))
      setBusy(null)
      return
    }
    router.replace("/sign-in")
    router.refresh()
  }

  const signOutAll = async () => {
    setBusy("all")
    setError(null)
    const result = await authClient.revokeSessions()
    if (result.error) {
      setError(messageFor(result.error))
      setBusy(null)
      return
    }
    await authClient.signOut()
    router.replace("/sign-in")
    router.refresh()
  }

  return (
    <div className={styles.actions}>
      <button type="button" onClick={signOut} disabled={busy !== null}>{busy === "current" ? "Signing out…" : "Sign out"}</button>
      <button type="button" className={styles.dangerButton} onClick={signOutAll} disabled={busy !== null}>{busy === "all" ? "Revoking…" : "Sign out all sessions"}</button>
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
    </div>
  )
}
