import { Badge, ChevronDown } from "./primitives"

const questions = [
  [
    "What is Lex?",
    "Lex is a legal precedent engine for Indian law. It indexes rulings from the Supreme Court, the High Courts, and specialised tribunals, and lets you search them the way you would ask a colleague — in plain English, without operators or wildcards. Every result comes back with its citation chain resolved, so you can see how an authority has been treated before you rely on it.",
  ],
  [
    "How is this different from the databases I already use?",
    "Legacy platforms are keyword indexes with a search form bolted on: you translate your question into their query language and hope the words match. Lex resolves the proposition behind the question and retrieves the authority on that point, then puts the judgment on screen without the frames, spinners, and clicks in between.",
  ],
  [
    "What does the corpus cover?",
    "Supreme Court and High Court judgments, along with specialised tribunals. Ingestion is continuous — our parser cleans messy scans, extracts cross-citations, and categorises ratios automatically, so new rulings enter the index fully mapped rather than waiting on a manual editor.",
  ],
  [
    "Can I rely on the citations?",
    "That is the point of the product. Every ruling is hyperlinked and cross-referenced with paragraph-level pinpoints, and the treatment history — followed, distinguished, doubted, overruled — travels with the result. The judgment call stays yours, but the verification legwork is already done.",
  ],
  [
    "Does it write my arguments for me?",
    "No. Lex finds and verifies authority; it does not draft your case or replace your reading of a judgment. It gives you the ruling, the passage, and the citation, and gets out of the way.",
  ],
  [
    "Is my research confidential?",
    "Yes. Your queries describe your matter, so we treat them as privileged work product. They are not sold, not shared, and not used to train models for anyone else.",
  ],
  [
    "How will Lex be priced?",
    "We are planning a flat subscription for individual advocates, with chamber and firm tiers, rather than per-search or per-document metering. Final pricing goes out to the waitlist before launch.",
  ],
  [
    "When will Lex be available?",
    "We are rolling out early access now. Join the waitlist and we will send an invite as capacity opens up, along with the chance to shape what ships before wider release.",
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
