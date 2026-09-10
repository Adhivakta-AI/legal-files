import type { SVGProps } from "react"

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="100"
      height="100"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        fill="currentColor"
        d="M15 22h70v12H15zm11 15h48v39H26zM15 79h70v10H15z"
      />
      <path
        d="M36 41v31M50 41v31M64 41v31"
        stroke="var(--brand-mark-cutout, #ffffff)"
        strokeWidth="6"
      />
    </svg>
  )
}
