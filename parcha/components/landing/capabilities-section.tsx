import { Badge, SectionDivider } from "./primitives"

const capabilities = [
  [
    "Understands the proposition.",
    "Ask for a point of law in plain English. The engine resolves the ratio you are after instead of matching the words you happened to type.",
  ],
  [
    "Maps the citation graph.",
    "Followed, distinguished, doubted, overruled — every relationship between judgments is extracted and kept current, down to the paragraph.",
  ],
  [
    "Reads the whole record.",
    "Supreme Court, every High Court, and specialised tribunals in one index. No switching platforms halfway through a search.",
  ],
  [
    "Handles the messy originals.",
    "Our parser cleans scanned and badly typeset judgments, recovers structure, and normalises citations so nothing is lost to a bad PDF.",
  ],
  [
    "Pinpoints the paragraph.",
    "Results open on the passage that answers the question, with the surrounding reasoning intact and the pinpoint citation ready to copy.",
  ],
  [
    "Loads at the speed of thought.",
    "No frames, no spinners, no ten-click path to the judgment. The interface gets out of the way and stays out of it.",
  ],
]

const stats = [
  ["Corpus", "SC + HC", "Plus specialised tribunals"],
  ["Search input", "Plain English", "No operators to learn"],
  ["Citations", "Verified", "Cross-referenced and linked"],
  ["Interface", "Zero bloat", "Judgment first, always"],
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
            Every ruling, within reach.
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
        aria-label="Lex platform highlights"
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
