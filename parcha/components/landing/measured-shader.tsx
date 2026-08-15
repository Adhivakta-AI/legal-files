"use client"

import { useLayoutEffect, useRef } from "react"

export function MeasuredShader({
  wrapClassName,
  surfaceClassName,
  targetSelector,
  extraPad,
}: {
  wrapClassName: string
  surfaceClassName: string
  targetSelector: string
  extraPad: number
}) {
  const wrapper = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = wrapper.current
    const section = element?.closest("section")
    const target = section?.querySelector<HTMLElement>(targetSelector)
    if (!element || !section || !target) return

    const measure = () => {
      const sectionRect = section.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const halfRem =
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize) /
        2
      const padding = halfRem + extraPad

      element.style.top = `${targetRect.top - sectionRect.top - padding}px`
      element.style.height = `${targetRect.height + padding * 2}px`
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(section)
    observer.observe(target)
    window.addEventListener("resize", measure)

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [extraPad, targetSelector])

  return (
    <div ref={wrapper} className={wrapClassName} aria-hidden="true">
      <div className={`shader-bg ${surfaceClassName}`} />
    </div>
  )
}
