"use client"

import { FormEvent, useRef, useState } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { Badge } from "./primitives"
import { MeasuredShader } from "./measured-shader"

export function EarlyAccess() {
  const root = useRef<HTMLElement>(null)
  const [joined, setJoined] = useState(false)

  useGSAP(
    () => {
      if (joined)
        gsap.fromTo(
          ".waitlist-success",
          { autoAlpha: 0, y: 12 },
          { autoAlpha: 1, y: 0, duration: 0.45, ease: "power3.out" }
        )
    },
    { scope: root, dependencies: [joined] }
  )

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setJoined(true)
  }

  return (
    <section
      ref={root}
      className="promise-section"
      id="early-access"
      data-animate-section
    >
      <MeasuredShader
        wrapClassName="shader-wrap"
        surfaceClassName="early-shader-surface"
        targetSelector=".ea-headline-wrap"
        extraPad={40}
      />
      <div className="ea-container container">
        <div className="ea-content" data-reveal>
          <div className="ea-headline-wrap">
            <Badge className="ea-badge" icon="early">
              Early access
            </Badge>
            <h2 className="section-title ea-title">Lex is almost ready.</h2>
            <p className="ea-desc">
              We&apos;re inviting advocates and chambers to run it on real
              matters and help shape what ships.
            </p>
          </div>
          <div className="waitlist-form-wrapper ea-form-centered">
            {!joined ? (
              <form className="waitlist-form" onSubmit={submit}>
                <div className="form-row">
                  <label className="sr-only" htmlFor="waitlist-email">
                    Work email
                  </label>
                  <input
                    id="waitlist-email"
                    className="email-input"
                    type="email"
                    placeholder="you@chambers.in"
                    required
                  />
                  <button className="submit-button btn-chamfer" type="submit">
                    Join Waitlist
                  </button>
                </div>
                <p className="form-error" role="alert" aria-live="polite" />
                <div className="turnstile-container" aria-hidden="true">
                  <div className="turnstile-mock">
                    <span className="turnstile-checkbox" />
                    <span className="turnstile-label">
                      Verify you are human
                    </span>
                    <span className="turnstile-brand">
                      <svg viewBox="0 0 46 24" aria-hidden="true">
                        <path d="M12.2 17.8h26.1c.8-2.8-.8-4.3-2.8-4.6-.4-4.2-3.9-7.5-8.2-7.5-3.4 0-6.3 2-7.6 4.9a5.8 5.8 0 0 0-7.5 7.2Z" />
                        <path d="M7.1 19.8h28.8l1.2-1.2H10.3a5.2 5.2 0 0 0-3.2 1.2Z" />
                      </svg>
                      <strong>Cloudflare</strong>
                      <small>Privacy · Help</small>
                    </span>
                  </div>
                </div>
              </form>
            ) : (
              <div className="waitlist-success" role="status">
                <h3 className="success-heading">You&apos;re on the list!</h3>
                <p className="success-position">
                  Position: <span className="position-number">#--</span>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
