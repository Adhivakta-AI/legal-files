import { Badge, SectionDivider } from "./primitives"

const capabilities = [
  [
    "Understands your architecture.",
    "Builds a connected model of modules, dependencies, and relationships so reasoning happens across files and aligns with your architecture.",
  ],
  [
    "Tracks relationships, prevents breakage.",
    "Edits that respect function contracts, type boundaries, and dependency graphs — reducing bugs and regressions.",
  ],
  [
    "Strategizes before acting.",
    "Explore → Plan → Execute workflows ensure multiple steps are reasoned out before changes occur.",
  ],
  [
    "Executes complex coding workflows.",
    "From refactors to test generation to feature builds — coordinate tools, code edits, web search, and commands as needed.",
  ],
  [
    "Isolates agent sandboxes.",
    "Each agent runs in its own workspace so experiments are safe, parallel workflows don’t clash, and code changes stay isolated until you merge them.",
  ],
  [
    "Runs at full speed.",
    "Custom Rust inference engine optimized for CUDA and Metal — delivering up to 144 tokens per second on consumer hardware.",
  ],
]

const stats = [
  ["Latency", "0ms", "No round-trip required"],
  ["Privacy", "100%", "Air-gapped by design"],
  ["Cost / Token", "$0", "Your GPU, your tokens"],
  ["Uptime", "Local", "No dependency on cloud"],
]

export function CapabilitiesSection() {
  return (
    <>
      <section className="illust-features" data-animate-section>
        <div className="container">
          <Badge className="capabilities-badge" icon="capabilities">
            Capabilities
          </Badge>
          <h2 className="section-title capabilities-title" data-reveal>
            Your machine, unleashed.
          </h2>
          <div className="illust-grid" data-stagger>
            {capabilities.map(([title, description], index) => (
              <article className="illust-card" key={title}>
                <div className="illust-label mono">
                  [ {String(index + 1).padStart(2, "0")} ]
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <SectionDivider />
      <section
        className="stats-strip"
        aria-label="Rig performance statistics"
        data-stagger
      >
        {stats.map(([label, value, note]) => (
          <div className="stat-box" key={label}>
            <span className="stat-label mono-label">{label}</span>
            <span className="stat-value">{value}</span>
            <span className="stat-note">{note}</span>
          </div>
        ))}
      </section>
      <SectionDivider />
    </>
  )
}
