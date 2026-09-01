import "server-only"

import { betterAuth } from "better-auth"

import {
  sendPasswordResetEmail,
  sendVerificationEmail as deliverVerificationEmail,
} from "@/lib/auth-email"
import {
  discardEmailVerificationToken,
  registerEmailVerificationToken,
} from "@/lib/auth-verification"
import { cloudflareEnv, requiredServerSetting, serverSetting } from "@/lib/server-env"

export function isGoogleAuthConfigured() {
  return Boolean(serverSetting("GOOGLE_CLIENT_ID") && serverSetting("GOOGLE_CLIENT_SECRET"))
}

export function getAuth() {
  const baseURL =
    serverSetting("BETTER_AUTH_URL") ??
    serverSetting("NEXT_PUBLIC_SITE_URL") ??
    "http://localhost:3000"
  const googleClientId = serverSetting("GOOGLE_CLIENT_ID")
  const googleClientSecret = serverSetting("GOOGLE_CLIENT_SECRET")

  return betterAuth({
    appName: "Lex Archives",
    baseURL,
    secret: requiredServerSetting("BETTER_AUTH_SECRET"),
    database: cloudflareEnv().AUTH_DB,
    trustedOrigins: [baseURL],
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => sendPasswordResetEmail(user.email, url),
    },
    emailVerification: {
      expiresIn: 60 * 60,
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url, token }) => {
        await registerEmailVerificationToken(token, user.email)
        try {
          await deliverVerificationEmail(user.email, url)
        } catch (error) {
          await discardEmailVerificationToken(token)
          throw error
        }
      },
    },
    socialProviders:
      googleClientId && googleClientSecret
        ? {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
              requireEmailVerification: true,
            },
          }
        : {},
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        allowDifferentEmails: false,
        requireLocalEmailVerified: true,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: baseURL.startsWith("https://"),
      defaultCookieAttributes: {
        httpOnly: true,
        secure: baseURL.startsWith("https://"),
        sameSite: "lax",
        path: "/",
      },
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-up/email": { window: 60 * 60, max: 5 },
        "/request-password-reset": { window: 60 * 60, max: 5 },
      },
    },
  })
}

export type LexAuth = ReturnType<typeof getAuth>
