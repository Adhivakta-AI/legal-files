import { Badge, ChevronDown } from "./primitives"

const questions = [
  [
    "What is Rig?",
    "Rig is a local-first AI coding assistant that runs entirely on your machine. It uses a modified open-source model post-trained exclusively for code, executed by a custom Rust inference engine optimized for Apple Silicon. Rig delivers fast and low latency agentic coding, requires no API calls, has no usage caps, collects zero telemetry, and costs $0 per token. All code and files stay on your machine. Rig currently supports macOS with Linux and Windows support planned.",
  ],
  [
    "What Model does Rig use?",
    "Rig uses a customized open source model. We modified it to work exclusively with the Rig agent harness, context engine, and tools. This allows us to shrink the model's total footprint without losing intelligence or coding capability.",
  ],
  [
    "What are the Hardware Requirements?",
    "Rig is currently optimized to run on Apple Silicon devices using M2 or later with at least 32GB of RAM. We hope to continue optimizing to reduce the memory requirements and one day work well with only 16GB of RAM. Support for Window and Linux are coming soon.",
  ],
  [
    "How Does Rig Compare to Large Cloud Models?",
    "Rig's model is still in development so we do not have benchmarks available yet. Our early tests indicate the Rig model will be on par with state of the art models thanks to the combination of our context engine and post training pipeline.",
  ],
  [
    "Can Rig Search the Web?",
    "Yes, Rig has all the same tools you'd expect from a coding agent, including web search, file read / write, plan mode, and more.",
  ],
  [
    "How will Rig be Priced?",
    "Rig's pricing model is planned to be a flat monthly or annual subscription on par with other coding agents but completely unlimited  and offline.",
  ],
  [
    "Will Rig Collect my Data?",
    "No, Rig is committed to being the most secure and private coding agent available. Our telemetry will be limited to a license check with a grace period. Your code and conversations will never leave your machine.",
  ],
  [
    "When Will Rig be Available?",
    "We are rolling out closed beta access now. Keep an eye on your email for an invite to the test builds and slack community. Wider release is planned for Q3 2026. We're focused on creating the best possible coding assistant capable of supporting real software engineers on their most important projects.",
  ],
]

export function FaqSection() {
  return (
    <section className="faq-section" data-animate-section>
      <div className="container">
        <Badge className="faq-badge" icon="faq">
          FAQ
        </Badge>
        <h2 className="section-title faq-title" data-reveal>
          Frequently asked questions.
        </h2>
        <div className="faq-list" data-reveal>
          {questions.map(([question, answer], index) => (
            <details className="faq-item" key={question}>
              <summary className="faq-question">
                <span className="faq-question-number mono-label">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="faq-question-text">{question}</span>
                <span className="faq-chevron">
                  <ChevronDown />
                </span>
              </summary>
              <div className="faq-answer-wrap">
                <div className="faq-answer">
                  <p>{answer}</p>
                </div>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
