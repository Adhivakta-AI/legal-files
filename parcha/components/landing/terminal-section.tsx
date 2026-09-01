"use client"

import { useEffect, useRef, useState } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { Badge } from "./primitives"

gsap.registerPlugin(ScrollTrigger)

const prompts = [
  "when is a dying declaration admissible",
  "anticipatory bail after chargesheet is filed",
  "test for arbitrariness under Article 14",
  "condonation of delay in government appeals",
  "writ against a private body on public duty",
  "limitation period under section 138 NI Act",
]

const annotations = [
  ["Ratio Engine", "Reads the proposition, not the words"],
  ["Citation Graph", "Every judgment, cross-referenced"],
  ["Full Corpus", "Supreme Court, High Courts, tribunals"],
  ["Instant Retrieval", "Judgment on screen in milliseconds"],
  ["Pinpoint Results", "Opens on the paragraph that matters"],
  ["Court-Ready", "Citations formatted for filing"],
]

function useTypewriter(active: boolean) {
  const [text, setText] = useState("test for arbitrariness under ")

  useEffect(() => {
    if (!active) return

    let stopped = false
    let prompt = 0
    let timeout: ReturnType<typeof setTimeout>

    const type = (value: string, index = 0) => {
      if (stopped) return
      setText(value.slice(0, index))
      if (index <= value.length)
        timeout = setTimeout(() => type(value, index + 1), 70)
      else timeout = setTimeout(() => erase(value), 2000)
    }
    const erase = (value: string) => {
      if (stopped) return
      const next = value.slice(0, -1)
      setText(next)
      if (next.length) timeout = setTimeout(() => erase(next), 30)
      else {
        prompt = (prompt + 1) % prompts.length
        timeout = setTimeout(() => type(prompts[prompt]), 400)
      }
    }

    timeout = setTimeout(() => type(prompts[0]), 500)
    return () => {
      stopped = true
      clearTimeout(timeout)
    }
  }, [active])

  return text
}

export function TerminalSection() {
  const sectionRef = useRef<HTMLElement>(null)
  const [typewriterActive, setTypewriterActive] = useState(false)
  const typed = useTypewriter(typewriterActive)

  useGSAP(
    () => {
      const lines = gsap.utils.toArray<HTMLElement>("[data-terminal-line]")
      gsap.set(lines, { autoAlpha: 0 })
      gsap.to(lines, {
        autoAlpha: 1,
        duration: 0.01,
        stagger: 0.28,
        ease: "none",
        scrollTrigger: {
          trigger: ".monitor-casing",
          start: "top 72%",
          once: true,
        },
      })
      gsap.fromTo(
        ".monitor-casing",
        { y: 30, scale: 0.97 },
        {
          y: 0,
          scale: 1,
          duration: 0.85,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ".monitor-casing",
            start: "top 78%",
            once: true,
          },
        }
      )
      ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top 90%",
        end: "bottom 10%",
        onEnter: () => setTypewriterActive(true),
        onEnterBack: () => setTypewriterActive(true),
        onLeave: () => setTypewriterActive(false),
        onLeaveBack: () => setTypewriterActive(false),
      })
    },
    { scope: sectionRef }
  )

  return (
    <section
      ref={sectionRef}
      className="terminal-section grid-bg"
      data-animate-section
    >
      <div className="container">
        <div className="term-header" data-reveal>
          <Badge className="term-badge" icon="engineered">
            Engineered intelligence
          </Badge>
          <h2 className="section-title term-title">Built to be cited</h2>
        </div>
        <div className="terminal-artifact">
          <div className="terminal-blueprint-left" aria-hidden="true">
            {annotations.slice(0, 3).map(([title, desc], index) => (
              <div
                className={`bp-anno bp-at-${34 + index * 16}`}
                style={{ top: `${34 + index * 16}%` }}
                key={title}
              >
                <span className="bp-text">
                  <span className="bp-title">{title}</span>
                  <br />
                  <span className="bp-desc">{desc}</span>
                </span>
                <span className="bp-line-left" />
                <span className="bp-dot" />
              </div>
            ))}
          </div>
          <div className="terminal-blueprint-right" aria-hidden="true">
            {annotations.slice(3).map(([title, desc], index) => (
              <div
                className="bp-anno"
                style={{ top: `${34 + index * 16}%` }}
                key={title}
              >
                <span className="bp-dot" />
                <span className="bp-line-right" />
                <span className="bp-text">
                  <span className="bp-title">{title}</span>
                  <br />
                  <span className="bp-desc">{desc}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="monitor-casing">
            <div className="monitor-vents">
              {Array.from({ length: 6 }).map((_, index) => (
                <span className="monitor-vent" key={index} />
              ))}
            </div>
            <div className="monitor-screen-bezel">
              <div className="terminal-window">
                <div className="terminal-bar">
                  <div className="terminal-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="terminal-title">lex://research · live</span>
                  <span className="blink-dot blink-dot-sm" />
                </div>
                <div className="terminal-body">
                  <div data-terminal-line>
                    <span className="prompt">λ</span>{" "}
                    <span className="cmd">lex init</span>
                  </div>
                  <div className="term-line-gap-sm" data-terminal-line>
                    <pre className="term-ascii">{`  ██╗      ███████╗ ██╗  ██╗
  ██║      ██╔════╝ ╚██╗██╔╝
  ██║      █████╗    ╚███╔╝
  ██║      ██╔══╝    ██╔██╗
  ███████╗ ███████╗ ██╔╝ ██╗
  ╚══════╝ ╚══════╝ ╚═╝  ╚═╝`}</pre>
                  </div>
                  <div className="term-line-gap-sm output" data-terminal-line>
                    &gt; Connecting to corpus...
                  </div>
                  <div className="output" data-terminal-line>
                    &gt; Supreme Court · High Courts · Tribunals
                  </div>
                  <div className="output" data-terminal-line>
                    &gt; Loading LEX engine <span className="success">OK</span>
                  </div>
                  <div className="output" data-terminal-line>
                    &gt; Citation graph resolved · ratios mapped
                  </div>
                  <div className="term-line-gap success" data-terminal-line>
                    ✓ Ready.{" "}
                    <span className="info">
                      Operators: <span className="term-off">NONE</span> ·
                      Clutter: <span className="term-off">NONE</span>
                    </span>
                  </div>
                  <div className="term-line-gap" data-terminal-line>
                    <span className="prompt">λ</span>{" "}
                    <span className="cmd">{typed}</span>{" "}
                    <span className="cursor-block" />
                  </div>
                </div>
              </div>
            </div>
            <div className="monitor-bezel-bottom">
              <span>Ratio Engine</span>
              <span className="monitor-led" />
              <span className="model-tag">LX-1</span>
              <span>Live Index</span>
            </div>
          </div>
          <div className="terminal-annotations-grid">
            {annotations.map(([title, desc]) => (
              <div className="terminal-anno-item" key={title}>
                <div className="terminal-anno-title">{title}</div>
                <div className="terminal-anno-desc">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
