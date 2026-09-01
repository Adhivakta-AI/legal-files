"use client"

import { useRef, useState } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { ApproachShader } from "./approach-shader"
import { Badge } from "./primitives"

gsap.registerPlugin(ScrollTrigger)

const nbsp = (count: number) => "\u00a0".repeat(count)

const steps = [
  {
    title: "Exhaustive jurisprudential mapping.",
    paragraphs: [
      "We continuously ingest and structure raw rulings from the Supreme Court, High Courts, and specialised tribunals. Our parser cleans messy scans, extracts cross-citations, and categorises ratios automatically.",
      "Nothing waits on a human indexer. A judgment delivered this morning is parsed, linked, and searchable by the time you go looking for it.",
    ],
    cardTitle: "Corpus Coverage",
    card: (
      <>
        <span className="hl-dim">Judgments mapped into the index</span>
        <br />
        <br />
        <span className="hl-bright">Lex</span>
        {nbsp(13)}
        <span className="hl-green">████████████████████</span>{" "}
        <span className="hl-green">SC · HC · tribunals</span>
        <br />
        <span className="hl-dim">Legacy platforms</span>{" "}
        <span className="hl-dim">████░░░░░░░░░░░░░░░░</span>{" "}
        <span className="hl-dim">partial · manual</span>
        <br />
        <br />
        <span className="hl-dim">
          Legacy databases index what an
          <br />
          editor got around to reading,
          <br />
          when they got around to it.
        </span>
        <br />
        <br />
        <span className="hl-bright">
          Lex maps the whole record,
          <br />
          continuously.
        </span>
      </>
    ),
  },
  {
    title: "Intent-first retrieval, not keyword matching.",
    paragraphs: [
      "The engine resolves what you are actually asking — the proposition, the ratio, the point of law — instead of hunting for the exact words you happened to type.",
      "No proximity operators. No wildcards. No nested Booleans. Ask it the way you would ask a senior in chambers.",
    ],
    cardTitle: "Search Input",
    card: (
      <>
        <span className="hl-dim">Syntax you have to learn</span>
        <br />
        <br />
        <span className="hl-dim">Boolean ops</span>
        {nbsp(2)}
        <span className="hl-dim">████████████████████</span>{" "}
        <span className="hl-dim">required</span>
        <br />
        <span className="hl-dim">Wildcards</span>
        {nbsp(4)}
        <span className="hl-dim">██████░░░░░░░░░░░░░░</span>{" "}
        <span className="hl-dim">required</span>
        <br />
        <span className="hl-bright">Lex</span>
        {nbsp(10)}
        <span className="hl-green">▎</span>
        <span className="hl-dim">░░░░░░░░░░░░░░░░░░░</span>{" "}
        <span className="hl-green">plain English</span>
        <br />
        <br />
        <span className="hl-dim">One question in.</span>
        <br />
        <span className="hl-dim">Authority out:</span>{" "}
        <span className="hl-green">verified</span>
      </>
    ),
  },
  {
    title: "Citations built to be filed, not just read.",
    paragraphs: [
      "Every result carries its full citation chain — what it followed, what it distinguished, and what has since been overruled — resolved at the paragraph level.",
      "You see the standing of an authority before you rely on it, so nothing goes into a filing that cannot survive the bench.",
    ],
    cardTitle: "Verification",
    card: (
      <>
        <span className="hl-dim">Time spent verifying</span>
        <br />
        <br />
        <span className="hl-bright">Lex</span>
        {nbsp(10)}
        <span className="hl-green">▎</span>
        <span className="hl-dim">░░░░░░░░░░░░░░░░░░░</span>{" "}
        <span className="hl-green">seconds</span>
        <br />
        <span className="hl-dim">Manual check</span>
        {nbsp(1)}
        <span className="hl-dim">████████████████████</span>{" "}
        <span className="hl-dim">hours per issue</span>
        <br />
        <br />
        <span className="hl-dim">Treatment history</span>
        <br />
        <br />
        <span className="hl-bright">Lex</span>
        {nbsp(30)}
        <span className="hl-green">resolved</span>
        <br />
        <span className="hl-dim">Manual check</span>
        {nbsp(1)}
        <span className="hl-dim">████████████████████</span>{" "}
        <span className="hl-dim">tab by tab</span>
      </>
    ),
  },
]

export function ApproachSection() {
  const sectionRef = useRef<HTMLElement>(null)
  const timerRef = useRef<gsap.core.Tween | null>(null)
  const sectionVisibleRef = useRef(false)
  const interactionPausedRef = useRef(false)
  const reducedMotionRef = useRef(false)
  const [active, setActive] = useState(0)

  const syncTimerPlayback = () => {
    const timer = timerRef.current
    if (!timer) return

    if (sectionVisibleRef.current && !interactionPausedRef.current) timer.play()
    else timer.pause()
  }

  useGSAP(
    () => {
      const fills = sectionRef.current?.querySelectorAll<HTMLElement>(
        ".how-step-progress-fill"
      )
      const fill = fills?.[active]
      if (!fill) return

      reducedMotionRef.current = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches

      gsap.set(fills, { scaleY: 0 })

      if (reducedMotionRef.current) {
        gsap.set(fill, { scaleY: 1 })
        return
      }

      const tween = gsap.to(fill, {
        scaleY: 1,
        transformOrigin: "top",
        duration: 6,
        ease: "none",
        paused: true,
        onComplete: () => setActive((value) => (value + 1) % steps.length),
      })
      timerRef.current = tween
      syncTimerPlayback()

      const cardTween = gsap.fromTo(
        ".card-content-display",
        { autoAlpha: 0, y: 8 },
        { autoAlpha: 1, y: 0, duration: 0.38, ease: "power2.out" }
      )

      return () => {
        if (timerRef.current === tween) timerRef.current = null
        tween.kill()
        cardTween.kill()
      }
    },
    { scope: sectionRef, dependencies: [active], revertOnUpdate: true }
  )

  useGSAP(
    () => {
      if (reducedMotionRef.current) return

      const trigger = ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top 90%",
        end: "bottom 10%",
        onToggle: ({ isActive }) => {
          sectionVisibleRef.current = isActive
          syncTimerPlayback()
        },
      })

      sectionVisibleRef.current = trigger.isActive
      syncTimerPlayback()

      return () => {
        sectionVisibleRef.current = false
        trigger.kill()
      }
    },
    { scope: sectionRef }
  )

  const pauseTimer = () => {
    interactionPausedRef.current = true
    syncTimerPlayback()
  }

  const resumeTimer = () => {
    interactionPausedRef.current = false
    syncTimerPlayback()
  }

  const selectStep = (index: number) => {
    if (index !== active) {
      setActive(index)
      return
    }

    timerRef.current?.restart()
    syncTimerPlayback()
  }

  return (
    <section
      ref={sectionRef}
      className="how-section"
      id="our-approach"
      data-animate-section
    >
      <div className="container">
        <div className="how-intro" data-reveal>
          <Badge className="how-intro-badge" icon="approach">
            Our Approach
          </Badge>
          <h2 className="how-intro-heading section-title">
            Legal research rebuilt from the index up.
          </h2>
          <p className="how-intro-body">
            We discarded legacy database structures and engineered an
            intent-first search pipeline designed for active litigators.
          </p>
        </div>
        <div
          className="how-stepper"
          onMouseEnter={pauseTimer}
          onMouseLeave={resumeTimer}
        >
          <div className="how-steps-left">
            {steps.map((step, index) => (
              <button
                className={`how-step ${active === index ? "active" : ""}`}
                type="button"
                key={step.title}
                data-step={index + 1}
                aria-current={active === index ? "step" : undefined}
                onClick={() => selectStep(index)}
              >
                <span className="how-step-progress">
                  <span className="how-step-progress-fill" />
                </span>
                <span className="how-step-header">
                  <span className="how-step-num">Step 0{index + 1}</span>
                  <h3>{step.title}</h3>
                </span>
                <span className="how-step-body">
                  <span className="how-step-body-inner">
                    {step.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="how-illustration">
            <ApproachShader />
            <div className="shader-overlay-card">
              <span className="card-title">{steps[active].cardTitle}</span>
              <div className="card-content-display" data-card-step={active + 1}>
                {steps[active].card}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
