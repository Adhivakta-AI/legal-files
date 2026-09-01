import Image from "next/image"
import Link from "next/link"
import { ReturnArrow, RigMark } from "./primitives"

export function FinalCta() {
  return (
    <section className="cta-section" data-animate-section>
      <div className="cta-vortex-wrap" aria-hidden="true">
        <Image
          className="cta-vortex-img"
          src="/assets/cta/cta-vortex.png"
          alt=""
          width={2106}
          height={1307}
          sizes="105vw"
        />
      </div>
      <RigMark className="cta-oversized-svg" outline />
      <div className="cta-container container">
        <div className="cta-logo-wrap" data-reveal>
          <RigMark className="cta-logo-glow" />
          <RigMark className="cta-logo" />
        </div>
        <div className="cta-heading-wrap" data-reveal>
          <div className="cta-heading-blur" />
          <h2
            className="glitch-text"
            data-text="Find the ruling, not the syntax"
          >
            Find the ruling, not the syntax
          </h2>
        </div>
        <div className="cta-btn-wrap" data-reveal>
          <a href="#early-access" className="btn-chamfer btn-cta cta-btn">
            Request Early Access <ReturnArrow />
          </a>
        </div>
        <p className="cta-fine-print">No credit card. No search limits.</p>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer>
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href="/" aria-label="Lex — Home">
              <Image
                className="footer-logo"
                src="/assets/brand/rig-wordmark.svg"
                alt="Lex"
                width={60}
                height={22}
                style={{ width: "auto" }}
              />
            </Link>
            <p>
              The precedent engine for Indian law. Built for advocates who cite
              for a living.
            </p>
          </div>
          <div className="footer-col">
            <h3 className="mono-label">Connect</h3>
            <ul>
              <li>
                <a
                  href="https://x.com/rig_code"
                  target="_blank"
                  rel="noreferrer"
                >
                  Twitter
                </a>
              </li>
              <li>
                <a
                  href="https://www.linkedin.com/company/get-rig/"
                  target="_blank"
                  rel="noreferrer"
                >
                  LinkedIn
                </a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h3 className="mono-label">Legal</h3>
            <ul>
              <li>
                <Link href="/terms">Terms of Service</Link>
              </li>
              <li>
                <Link href="/privacy">Privacy Policy</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span className="mono-label">© 2026 Lex. All rights reserved.</span>
          <div className="status footer-status">
            <span className="footer-status-dot" />
            <span>All systems operational</span>
          </div>
        </div>
      </div>
      <RigMark className="footer-watermark" outline />
    </footer>
  )
}
