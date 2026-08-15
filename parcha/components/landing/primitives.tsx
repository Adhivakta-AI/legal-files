import type { SVGProps } from "react"

const rigPaths = [
  "M162.809 89.412H82.684c-7.9 0-15.478 3.14-21.063 8.73-5.577 5.583-8.71 13.152-8.71 21.043v40.811h19.26V126.45c0-9.638.173-18.449.173-18.449h90.465V89.412Z",
  "M162.808 118.61h-50.993c-7.9 0-15.478 3.14-21.063 8.73-5.577 5.583-8.71 13.152-8.71 21.044v11.613h22.867v-15.945c0-9.638 0-9.97 0-9.97h57.899V118.61Z",
  "M162.809 146.002c-18.103 0-28.242-.006-46.345.002V160h46.345v-13.998Z",
  "M162.809.003H70.886C52.08.003 34.045 7.476 20.75 20.777 7.464 34.07 0 52.095 0 70.889c0 28.397 0 69.878 0 89.108h15.785V67.714c0-14.457 0-26.177 0-26.177h147.027V0l-.003.003Z",
  "M162.809 51.87H56.804c-7.9 0-15.478 3.141-21.063 8.73-5.577 5.583-8.71 13.152-8.71 21.044v78.353h14.785V96.318c0-9.638 0-17.449 0-17.449h120.993V51.867v.003Z",
]

type RigMarkProps = SVGProps<SVGSVGElement> & {
  outline?: boolean
}

export function RigMark({ outline = false, ...props }: RigMarkProps) {
  return (
    <svg viewBox="0 0 163 160" fill="none" aria-hidden="true" {...props}>
      {rigPaths.map((path) => (
        <path
          key={path}
          d={path}
          fill={outline ? "none" : "currentColor"}
          stroke={outline ? "currentColor" : "none"}
          strokeWidth={outline ? 0.5 : undefined}
        />
      ))}
    </svg>
  )
}

export type PixelIconType =
  | "problem"
  | "introducing"
  | "offline"
  | "unlimited"
  | "privacy"
  | "latency"
  | "approach"
  | "capabilities"
  | "engineered"
  | "early"
  | "faq"

const pixelIconPaths: Record<PixelIconType, string> = {
  problem:
    "M11 11h2v2h-2zM15 7h2v2h-2zM7 7h2v2H7zM7 15h2v2H7zM15 15h2v2h-2zM5 17h2v2H5zM5 5h2v2H5zM9 13h2v2H9zM13 13h2v2h-2zM13 9h2v2h-2zM9 9h2v2H9zM17 5h2v2h-2zM17 17h2v2h-2z",
  introducing:
    "M14 11h2v2h-2zM18 7h2v2h-2zM4 13h2v2H4zM10 15h2v2h-2zM8 17h2v2H8zM12 13h2v2h-2zM16 9h2v2h-2zM6 15h2v2H6z",
  offline: "M5 4h14v2H5zM19 15V6h2v11H3V6h2v9zM3 18h18v2H3z",
  unlimited:
    "M22 11v2h-2v2h-2V9h2v2zM6 10h2v4H6zM9 10h2v4H9zM12 10h2v4h-2zM15 10h2v4h-2zM18 7v2H5v6h13v2H3V7z",
  privacy:
    "M10 4h4v2h-4zM11 13h2v4h-2zM6 10h2V6h2v4h4V6h2v4h2v2H6zM6 18h12v2H6zM18 12h2v6h-2zM4 12h2v6H4z",
  latency:
    "M8 4h3V3H9V1h6v2h-2v1h3v2H8zM8 18h8v2H8zM16 6h2v2h-2zM18 8h2v8h-2zM4 8h2v8H4zM6 6h2v2H6zM11 8h2v3h3v2h-5zM6 16h2v2H6zM16 16h2v2h-2z",
  approach:
    "M10 4h6v2h-6zM10 16h6v2h-6zM16 6h2v2h-2zM18 8h2v6h-2zM6 8h2v6H6zM8 6h2v2H8zM8 14h2v2H8zM6 16h2v2H6zM4 18h2v2H4zM16 14h2v2h-2z",
  capabilities:
    "M6 4h2V2h2v2h4V2h2v2h2v2h2v2h2v2h-2v4h2v2h-2v2h-2v2h-2v2h-2v-2h-4v2H8v-2H6v-2H4v-2H2v-2h2v-4H2V8h2V6h2zM15 15h2v2h-2zM15 7h2v2h-2zM7 7h2v2H7zM7 15h2v2H7z",
  engineered:
    "M2 13h6v2H6v5H4v-5H2zM16 15h2V4h2v11h2v2h-2v3h-2v-3h-2zM9 7h2V4h2v3h2v2H9zM11 11h2v9h-2zM4 4h2v7H4z",
  early:
    "M5 5h14v2H5zM5 17h14v2H5zM19 7h2v10h-2zM3 7h2v10H3zM11 13h2v2h-2zM13 11h2v2h-2zM15 13h2v2h-2zM9 11h2v2H9zM7 13h2v2H7zM15 9h2v2h-2zM7 9h2v2H7z",
  faq: "M10 2h4v2h-4zM8 4h2v2H8zM14 4h2v2h-2zM6 6h2v2H6zM16 6h2v2h-2zM6 8h2v6H6zM16 8h2v6h-2zM14 14h2v2h-2zM12 16h2v2h-2zM12 20h2v2h-2z",
}

export function PixelIcon({ type = "problem" }: { type?: PixelIconType }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d={pixelIconPaths[type]} fill="currentColor" />
    </svg>
  )
}

export function Badge({
  children,
  className = "",
  icon = "problem",
}: {
  children: React.ReactNode
  className?: string
  icon?: PixelIconType
}) {
  return (
    <div className={`badge ${className}`.trim()}>
      <PixelIcon type={icon} />
      {children}
    </div>
  )
}

export function SectionDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`section-divider ${className}`.trim()} aria-hidden="true" />
  )
}

export function ChevronDown() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function ReturnArrow() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 4v8a4 4 0 0 1-4 4H5" />
      <polyline points="9 12 5 16 9 20" />
    </svg>
  )
}
