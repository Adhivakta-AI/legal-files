"use client"

import { useRef } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger, useGSAP)

export function AnimationController({
  children,
}: {
  children: React.ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const isMobile = window.matchMedia("(max-width: 768px)").matches

      gsap.set("[data-hero-reveal], [data-reveal], [data-stagger] > *", {
        autoAlpha: 1,
        clearProps: "transform",
      })

      gsap.utils
        .toArray<HTMLElement>("[data-animate-section]")
        .forEach((section) => {
          ScrollTrigger.create({
            trigger: section,
            start: "top bottom",
            end: "bottom top",
            onToggle: ({ isActive }) =>
              section.classList.toggle("is-visible", isActive),
          })
        })

      const interactive = gsap.utils.toArray<HTMLElement>(
        ".btn-chamfer, .illust-card"
      )
      const cleanups: Array<() => void> = []
      interactive.forEach((element) => {
        const enter = () =>
          gsap.to(element, { y: -2, duration: 0.22, ease: "power2.out" })
        const leave = () =>
          gsap.to(element, { y: 0, duration: 0.3, ease: "power2.out" })
        element.addEventListener("mouseenter", enter)
        element.addEventListener("mouseleave", leave)
        cleanups.push(() => {
          element.removeEventListener("mouseenter", enter)
          element.removeEventListener("mouseleave", leave)
        })
      })

      const eye =
        root.current?.querySelector<SVGSVGElement>("#surveillance-eye")
      const pupil = eye?.querySelector<SVGCircleElement>("#eye-pupil")
      if (eye && pupil && !isMobile) {
        const move = (event: PointerEvent) => {
          const bounds = eye.getBoundingClientRect()
          const dx = event.clientX - (bounds.left + bounds.width / 2)
          const dy = event.clientY - (bounds.top + bounds.height / 2)
          const distance = Math.max(Math.hypot(dx, dy), 1)
          const strength = Math.min(distance / 150, 1) * 16
          gsap.to(pupil, {
            attr: {
              cx: 240 + (dx / distance) * strength,
              cy: 240 + (dy / distance) * strength,
            },
            duration: 0.2,
            ease: "power2.out",
            overwrite: true,
          })
        }
        window.addEventListener("pointermove", move, { passive: true })
        cleanups.push(() => window.removeEventListener("pointermove", move))
      }

      return () => cleanups.forEach((cleanup) => cleanup())
    },
    { scope: root }
  )

  return (
    <div ref={root} className="landing-root">
      {children}
    </div>
  )
}

export function TextureOverlays() {
  return (
    <>
      <svg width="0" height="0" aria-hidden="true" className="noise-filter">
        <filter id="grainy" x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.4"
            numOctaves="4"
            stitchTiles="stitch"
            seed="0"
          >
            <animate
              attributeName="seed"
              from="0"
              to="100"
              dur="10s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 0 0 0 0"
          />
        </filter>
      </svg>
      <div className="scanlines" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />
      <div className="rgb-fringe" aria-hidden="true" />
    </>
  )
}
