import { Badge, SectionDivider } from "./primitives"
import { MeasuredShader } from "./measured-shader"

function LocalFlowDiagram() {
  return (
    <svg
      className="intro-diagram"
      viewBox="0 0 560 280"
      fill="none"
      aria-label="All Rig inference stays on your machine"
    >
      <defs>
        <linearGradient id="local-trail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#22c55e" stopOpacity="0" />
          <stop offset="0.7" stopColor="#22c55e" stopOpacity="0.3" />
          <stop offset="1" stopColor="#22c55e" stopOpacity="0.7" />
        </linearGradient>
        <path id="path-code-rig" d="M130 125h63" />
        <path id="path-rig-response" d="M353 125h70" />
        <path id="path-cloud-rig" d="M273 37v20" />
        <path id="path-rig-telemetry" d="M273 172v20" />
      </defs>
      <rect
        x="5"
        y="68"
        width="550"
        height="112"
        stroke="rgba(240,237,230,.08)"
        strokeDasharray="4 4"
      />
      <rect x="15" y="61" width="96" height="14" fill="var(--ink)" />
      <text x="20" y="71" className="diagram-label">
        YOUR MACHINE
      </text>

      <g className="svg-card">
        <rect
          x="20"
          y="100"
          width="110"
          height="50"
          fill="rgba(10,10,10,.95)"
          stroke="rgba(240,237,230,.15)"
        />
        <text x="75" y="121" textAnchor="middle" className="card-title">
          YOUR CODE
        </text>
        <text x="75" y="133" textAnchor="middle" className="card-sub">
          KEYSTROKES · FILES
        </text>
      </g>

      <path d="M130 125h63M353 125h70" stroke="rgba(34,197,94,.2)" />
      <path
        d="M130 125h63M353 125h70"
        stroke="url(#local-trail)"
        strokeWidth="2"
        strokeDasharray="12 80"
        className="diagram-flow"
      />
      <rect x="-1.5" y="-1.5" width="3" height="3" fill="#22c55e">
        <animateMotion dur="2s" repeatCount="indefinite">
          <mpath href="#path-code-rig" />
        </animateMotion>
        <animate
          attributeName="opacity"
          values="0;1;1;0"
          keyTimes="0;0.1;0.8;1"
          dur="2s"
          repeatCount="indefinite"
        />
      </rect>
      <rect x="-1.5" y="-1.5" width="3" height="3" fill="#22c55e">
        <animateMotion dur="2s" begin="1s" repeatCount="indefinite">
          <mpath href="#path-rig-response" />
        </animateMotion>
        <animate
          attributeName="opacity"
          values="0;1;1;0"
          keyTimes="0;0.1;0.8;1"
          dur="2s"
          begin="1s"
          repeatCount="indefinite"
        />
      </rect>

      <g className="svg-card">
        <rect
          x="193"
          y="78"
          width="160"
          height="94"
          fill="rgba(10,10,10,.96)"
          stroke="rgba(240,237,230,.2)"
          strokeWidth="1.5"
        />
        <text
          x="274.5"
          y="108"
          textAnchor="middle"
          className="rig-diagram-title"
        >
          RIG
        </text>
        <text x="273" y="124" textAnchor="middle" className="card-accent">
          ✓ LOCAL INFERENCE
        </text>
        <line x1="210" y1="145" x2="336" y2="145" className="card-divider" />
        <text x="238" y="160" textAnchor="middle" className="card-sub">
          GPU
        </text>
        <text x="273" y="160" textAnchor="middle" className="card-sub">
          INDEX
        </text>
        <text x="308" y="160" textAnchor="middle" className="card-sub">
          MODEL
        </text>
      </g>

      <g className="svg-card">
        <rect
          x="423"
          y="100"
          width="120"
          height="50"
          fill="rgba(10,10,10,.95)"
          stroke="rgba(240,237,230,.15)"
        />
        <text x="483" y="121" textAnchor="middle" className="card-title">
          RESPONSE
        </text>
        <text x="483" y="133" textAnchor="middle" className="card-accent">
          &lt;300ms · ON DEVICE
        </text>
      </g>

      <g className="diagram-blocked">
        <rect
          x="213"
          y="5"
          width="120"
          height="32"
          fill="rgba(10,10,10,.95)"
          stroke="rgba(240,237,230,.12)"
        />
        <text x="273" y="21" textAnchor="middle" className="card-title">
          CLOUD
        </text>
        <path
          d="M273 37v41"
          stroke="var(--accent)"
          strokeWidth=".5"
          strokeDasharray="3 5"
          opacity=".4"
        />
        <rect x="-1.5" y="-1.5" width="3" height="3" fill="var(--accent)">
          <animateMotion dur="1.5s" repeatCount="indefinite">
            <mpath href="#path-cloud-rig" />
          </animateMotion>
          <animate
            attributeName="opacity"
            values=".8;.8;0"
            keyTimes="0;.6;1"
            dur="1.5s"
            repeatCount="indefinite"
          />
        </rect>
        <path
          d="M267 51l12 12M279 51l-12 12"
          stroke="var(--accent)"
          strokeWidth="1.5"
        />
      </g>
      <g className="diagram-blocked">
        <path
          d="M273 172v43"
          stroke="var(--accent)"
          strokeWidth=".5"
          strokeDasharray="3 5"
          opacity=".4"
        />
        <rect x="-1.5" y="-1.5" width="3" height="3" fill="var(--accent)">
          <animateMotion dur="1.5s" begin=".75s" repeatCount="indefinite">
            <mpath href="#path-rig-telemetry" />
          </animateMotion>
          <animate
            attributeName="opacity"
            values=".8;.8;0"
            keyTimes="0;.6;1"
            dur="1.5s"
            begin=".75s"
            repeatCount="indefinite"
          />
        </rect>
        <path
          d="M267 187l12 12M279 187l-12 12"
          stroke="var(--accent)"
          strokeWidth="1.5"
        />
        <rect
          x="213"
          y="215"
          width="120"
          height="32"
          fill="rgba(10,10,10,.95)"
          stroke="rgba(240,237,230,.12)"
        />
        <text x="273" y="231" textAnchor="middle" className="card-title">
          TELEMETRY
        </text>
      </g>
    </svg>
  )
}

function OfflineGlobe() {
  return (
    <svg
      className="globe-svg"
      viewBox="0 0 900 900"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="rgba(240,237,230,.1)">
        <circle cx="450" cy="450" r="310" />
        <ellipse cx="450" cy="450" rx="200" ry="310" />
        <ellipse cx="450" cy="450" rx="90" ry="310" />
        {[250, 340, 450, 560, 650].map((cy, index) => (
          <ellipse
            key={cy}
            cx="450"
            cy={cy}
            rx={260 + Math.abs(index - 2) * 20}
            ry="34"
          />
        ))}
        <path d="M140 450h620M450 140v620" strokeDasharray="6 8" />
      </g>
      <g className="globe-line-left" stroke="rgba(240,237,230,.18)">
        <path d="M20 280h300M20 340h350M20 400h320M20 500h320M20 560h350M20 620h300" />
      </g>
      <g transform="translate(300 300)">
        <rect
          width="300"
          height="300"
          fill="rgba(10,10,10,.84)"
          stroke="rgba(240,237,230,.12)"
        />
        <rect
          x="70"
          y="-62"
          width="160"
          height="45"
          fill="var(--ink)"
          stroke="rgba(240,237,230,.12)"
        />
        <text x="150" y="-35" textAnchor="middle" className="globe-label">
          CLOUD SERVERS
        </text>
        <path d="M150-17v62" stroke="var(--accent)" strokeDasharray="4 5" />
        <path
          d="m140 18 20 20m0-20-20 20"
          stroke="var(--accent)"
          strokeWidth="2"
        />
        <text x="172" y="31" className="blocked-label">
          SEVERED
        </text>
        <rect
          x="52"
          y="75"
          width="196"
          height="80"
          fill="var(--ink)"
          stroke="rgba(240,237,230,.2)"
        />
        <text x="150" y="105" textAnchor="middle" className="globe-title">
          YOUR MACHINE
        </text>
        <text x="150" y="127" textAnchor="middle" className="globe-active">
          ✓ RIG MODEL ACTIVE
        </text>
        <path d="M150 155v55" stroke="var(--accent)" strokeDasharray="4 5" />
        <path
          d="m140 177 20 20m0-20-20 20"
          stroke="var(--accent)"
          strokeWidth="2"
        />
        <text x="172" y="190" className="blocked-label">
          SEVERED
        </text>
        <rect
          x="70"
          y="220"
          width="160"
          height="45"
          fill="var(--ink)"
          stroke="rgba(240,237,230,.12)"
        />
        <text x="150" y="247" textAnchor="middle" className="globe-label">
          NOTHING LEAVES
        </text>
      </g>
    </svg>
  )
}

const benefits = [
  [
    "Unlimited",
    "Remove the meter",
    "Refactor the whole codebase. Riff on an idea all day. Run agent loops without thinking about cost.",
    "unlimited",
  ],
  [
    "Privacy",
    "Sever the connection",
    "Your code, keystrokes, and files never leave your machine. Not anonymized. Not aggregated. Not sent.",
    "privacy",
  ],
  [
    "Latency",
    "Stop waiting",
    "No round-trip to a data center. Inference happens on your machine, in single-digit milliseconds.",
    "latency",
  ],
] as const

export function LocalSections() {
  return (
    <>
      <section
        className="offline-section three-col intro-section"
        id="intro-rig"
        data-animate-section
      >
        <MeasuredShader
          wrapClassName="intro-shader-wrap"
          targetSelector=".intro-headline-wrap"
          extraPad={50}
          canvasId="shader3"
        />
        <div className="intro-container container">
          <div className="intro-flex">
            <div className="intro-headline-wrap" data-reveal>
              <Badge className="intro-badge" icon="introducing">
                Introducing Rig
              </Badge>
              <h2 className="display intro-title">
                Everything local.
                <br />
                Own your AI.
              </h2>
              <p className="intro-desc">
                A complete AI coding agent running entirely on your own
                hardware. No usage limits. No cloud dependency.
              </p>
            </div>
            <div className="intro-spacer" />
            <div className="intro-diagram-wrap" data-reveal>
              <LocalFlowDiagram />
            </div>
          </div>
        </div>
      </section>
      <SectionDivider />

      <section
        className="offline-section work-offline-section"
        data-animate-section
      >
        <div className="container">
          <div className="offline-layout">
            <div className="offline-visual" data-reveal>
              <OfflineGlobe />
            </div>
            <div className="offline-content" data-reveal>
              <Badge className="offline-badge" icon="offline">
                Offline
              </Badge>
              <h2>Work offline</h2>
              <p>
                Flights. Spotty Wi-Fi. Network outages. Nothing stops your flow.
              </p>
            </div>
          </div>
        </div>
      </section>
      <SectionDivider />

      <section
        className="offline-section three-col benefits-section"
        data-animate-section
      >
        <div className="three-col-container container">
          <div className="three-col-grid" data-stagger>
            {benefits.map(([label, title, description, icon], index) => (
              <div className="contents" key={title}>
                {index > 0 && <div className="three-col-divider" />}
                <article className="three-col-cell">
                  <div className="three-col-inner">
                    <Badge className="three-col-badge" icon={icon}>
                      {label}
                    </Badge>
                    <h3 className="three-col-heading">{title}</h3>
                    <p className="three-col-text">{description}</p>
                  </div>
                </article>
              </div>
            ))}
          </div>
        </div>
      </section>
      <SectionDivider />
    </>
  )
}
