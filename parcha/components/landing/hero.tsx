import { Header } from "./header"
import { RigMark } from "./primitives"

const ticker = [
  "Supreme Court & High Courts",
  "Intent-based retrieval",
  "Verifiable citations",
  "Zero bloat",
  "No search operators",
  "Tribunals & special benches",
  "Built for litigators",
]

export function Hero() {
  return (
    <section className="hero is-visible" id="top">
      <Header />
      <RigMark className="hero-watermark" />
      <div className="hero-content">
        <h1 data-hero-reveal style={{ marginTop: "2rem" }}>
          The Ultimate Legal
          <br />
          Precedent Engine.
        </h1>
        <p className="hero-sub" data-hero-reveal>
          The entire history of Indian jurisprudence, executing at the speed of
          thought. No manual indexing. No slow loading times. Uncompromised
          authority.
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
