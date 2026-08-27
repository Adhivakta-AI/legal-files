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
    title: "A focused model, trained specifically for coding.",
    paragraphs: [
      "Every parameter in the model is dedicated to coding, planning, tool use, and structured edits. The entire training process is focused on engineering work.",
      "By narrowing the domain, we concentrate intelligence where it matters — deeper reasoning, better code, sharper tool use.",
    ],
    cardTitle: "Training Focus",
    card: (
      <>
        <span className="hl-dim">Parameters dedicated to code</span>
        <br />
        <br />
        <span className="hl-bright">Rig</span>
        {nbsp(11)}
        <span className="hl-green">████████████████████</span>{" "}
        <span className="hl-green">100%</span>
        <br />
        <span className="hl-dim">Most AI models</span>{" "}
        <span className="hl-dim">████░░░░░░░░░░░░░░░░</span>{" "}
        <span className="hl-dim">~15–20%</span>
        <br />
        <br />
        <span className="hl-dim">
          General-purpose models spread capacity
          <br />
          across chat, translation, creative
          <br />
          writing, and more.
        </span>
        <br />
        <br />
        <span className="hl-bright">
          Rig dedicates every parameter
          <br />
          to engineering.
        </span>
      </>
    ),
  },
  {
    title: "Full intelligence, compressed to fit your machine.",
    paragraphs: [
      "The model is compressed to run efficiently on consumer machines — carefully preserving the reasoning patterns that matter most.",
      "The result is an 8 GB model that fits comfortably in memory on a MacBook. Full reasoning. Local execution. Zero cost per token.",
    ],
    cardTitle: "Model Size",
    card: (
      <>
        <span className="hl-dim">Model size (memory required)</span>
        <br />
        <br />
        <span className="hl-dim">Cloud models</span>
        {nbsp(1)}
        <span className="hl-dim">████████████████████</span>{" "}
        <span className="hl-dim">200+ GB</span>
        <br />
        <span className="hl-dim">Open source</span>
        {nbsp(2)}
        <span className="hl-dim">██████░░░░░░░░░░░░░░</span>{" "}
        <span className="hl-dim">28–140 GB</span>
        <br />
        <span className="hl-bright">Rig</span>
        {nbsp(10)}
        <span className="hl-green">▎</span>
        <span className="hl-dim">░░░░░░░░░░░░░░░░░░░</span>{" "}
        <span className="hl-green">8 GB</span>
        <br />
        <br />
        <span className="hl-dim">Fits in 16 GB unified memory.</span>
        <br />
        <span className="hl-dim">Accuracy loss:</span>{" "}
        <span className="hl-green">&lt;0.3%</span>
      </>
    ),
  },
  {
    title: "A custom runtime, engineered for Apple Silicon.",
    paragraphs: [
      "The model runs through a custom inference engine optimized specifically for Apple Silicon. Model, context engine, and tools are designed as a single coordinated system.",
      "That tight integration is what makes local execution fast, reliable, and practical.",
    ],
    cardTitle: "Performance",
    card: (
      <>
        <span className="hl-dim">First token latency</span>
        <br />
        <br />
        <span className="hl-bright">Rig</span>
        {nbsp(10)}
        <span className="hl-green">▎</span>
        <span className="hl-dim">░░░░░░░░░░░░░░░░░░░</span>{" "}
        <span className="hl-green">300 ms</span>
        <br />
        <span className="hl-dim">Cloud APIs</span>
        {nbsp(3)}
        <span className="hl-dim">████████████████████</span>{" "}
        <span className="hl-dim">400–1,000 ms</span>
        <br />
        <br />
        <span className="hl-dim">Cost per 1K tokens</span>
        <br />
        <br />
        <span className="hl-bright">Rig</span>
        {nbsp(30)}
        <span className="hl-green">$0.00</span>
        <br />
        <span className="hl-dim">Cloud APIs</span>
        {nbsp(3)}
        <span className="hl-dim">████████████████████</span>{" "}
        <span className="hl-dim">$0.01–0.06</span>
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
            Purpose beats scale.
          </h2>
          <p className="how-intro-body">
            Rig is a closed system — model, context, tools, and inference —
            engineered together for one job: real coding work.
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
