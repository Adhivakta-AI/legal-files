"use client"

import { useEffect, useRef, useState } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { Badge } from "./primitives"

gsap.registerPlugin(ScrollTrigger)

const prompts = [
  "refactor auth to use JWT",
  "write tests for the API layer",
  "find the memory leak in worker",
  "explain this regex to me",
  "add dark mode to settings page",
  "optimize the database queries",
]

const annotations = [
  ["Custom Model", "Optimized for consumer hardware"],
  ["Inference", "Cross-OS using Rust"],
  ["Context Graph", "Repo-wide code understanding"],
  ["Terminal UI", "Built in Rust and blazing fast"],
  ["Heavily Tuned", "Consistent tool calls and plan use"],
  ["Opinionated", "Focused on code correctness"],
]

function useTypewriter(active: boolean) {
  const [text, setText] = useState("explain this regex to ")

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
          <h2 className="section-title term-title">Built for control freaks</h2>
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
                  <span className="terminal-title">
                    rig://localhost · offline
                  </span>
                  <span className="blink-dot blink-dot-sm" />
                </div>
                <div className="terminal-body">
                  <div data-terminal-line>
                    <span className="prompt">λ</span>{" "}
                    <span className="cmd">rig init</span>
                  </div>
                  <div className="term-line-gap-sm" data-terminal-line>
                    <pre className="term-ascii">{`  ██████╗  ██╗  ██████╗
  ██╔══██╗ ██║ ██╔════╝
  ██████╔╝ ██║ ██║ ███╗
  ██╔══██╗ ██║ ██║  ██║
  ██║  ██║ ██║ ╚██████║
  ╚═╝  ╚═╝ ╚═╝  ╚═════╝`}</pre>
                  </div>
                  <div className="term-line-gap-sm output" data-terminal-line>
                    &gt; Scanning hardware...
                  </div>
                  <div className="output" data-terminal-line>
                    &gt; Found M4 · 16GB RAM
                  </div>
                  <div className="output" data-terminal-line>
                    &gt; Loading RIG Model <span className="success">OK</span>
                  </div>
                  <div className="output" data-terminal-line>
                    &gt; Indexing 2,418 files · 87,102 symbols
                  </div>
                  <div className="term-line-gap success" data-terminal-line>
                    ✓ Ready.{" "}
                    <span className="info">
                      Network: <span className="term-off">OFF</span> ·
                      Telemetry: <span className="term-off">OFF</span>
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
              <span>Neural Engine</span>
              <span className="monitor-led" />
              <span className="model-tag">RG-800</span>
              <span>Local Ops</span>
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
