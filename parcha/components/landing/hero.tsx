import { Header } from "./header"
import { RigMark } from "./primitives"

const ticker = [
  "Zero telemetry",
  "Native inference",
  "100% offline",
  "Your hardware, your rules",
  "No tokens, no limits",
  "Specialized SLM",
  "Unbounded context",
]

export function Hero() {
  return (
    <section className="hero is-visible" id="top">
      <Header />
      <RigMark className="hero-watermark" />
      <div className="hero-content">
        <h1 data-hero-reveal style={{ marginTop: "2rem" }}>
          On-device AI coding.
          <br />
          No cloud. No limits.
        </h1>
        <p className="hero-sub" data-hero-reveal>
          A complete coding agent that executes entirely on your machine. No API
          calls. No usage caps.
        </p>
        <div className="hero-actions" data-hero-reveal>
          <a href="#early-access" className="btn-chamfer btn-primary">
            Join Waitlist
          </a>
          <a href="#our-approach" className="btn-chamfer hero-outline-button">
            Our Approach
          </a>
        </div>
      </div>
      <div className="hero-ticker" aria-label={ticker.join(" · ")}>
        <div className="hero-ticker-inner" aria-hidden="true">
          {[...ticker, ...ticker]
            .map((item, index) => (
              <span key={`${item}-${index}`}>
                {index % 2 === 0 ? item : item}
              </span>
            ))
            .reduce<React.ReactNode[]>((nodes, item, index) => {
              nodes.push(item)
              if (index < ticker.length * 2 - 1)
                nodes.push(<span key={`dot-${index}`}>•</span>)
              return nodes
            }, [])}
        </div>
      </div>
    </section>
  )
}
