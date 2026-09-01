import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://lex-archives-app.politestranger18.workers.dev"
  ),
  title: "Lex Archives — Indian Case-Law Research",
  description:
    "Citation-grounded research across Indian Supreme Court judgments.",
  openGraph: {
    title: "Lex Archives — Indian Case-Law Research",
    description:
      "Citation-grounded research across Indian Supreme Court judgments.",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
