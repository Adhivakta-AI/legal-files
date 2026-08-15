import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title: "Rig - Local-First AI Coding Assistant",
  description:
    "A complete AI coding agent that executes entirely on your machine. No API calls. No usage caps. No cloud dependency.",
  icons: { icon: "/assets/brand/rig-icon.svg" },
  openGraph: {
    title: "Rig - Local-First AI Coding Assistant",
    description:
      "A complete AI coding agent that executes entirely on your machine. No API calls. No usage caps. No cloud dependency.",
    type: "website",
    images: [{ url: "/assets/brand/rig-graph.png", width: 1200, height: 630 }],
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
