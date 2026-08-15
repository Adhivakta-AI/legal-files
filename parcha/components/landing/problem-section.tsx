import { Badge } from "./primitives"

const problems = [
  {
    label: "Data extraction",
    number: "001",
    title: "They train on your code.",
    body: (
      <>
        Every prompt. Every file. Every fix.
        <br />
        It flows through infrastructure you don&apos;t control — improving
        systems they want to use to replace you.
      </>
    ),
  },
  {
    label: "Artificial scarcity",
    number: "002",
    title: "They meter your ambition.",
    body: (
      <>
        Slowdowns, overages, caps.
        <br />
        Right when you&apos;re deep in a sprint, the meter decides you&apos;ve
        had enough.
      </>
    ),
  },
  {
    label: "Silent downgrades",
    number: "003",
    title: "They change the model.",
    body: (
      <>
        They silently downgrade to cheaper models during peak load. Full price,
        degraded experience.
      </>
    ),
  },
  {
    label: "Cloud dependency",
    number: "004",
    title: "They control your flow.",
    body: (
      <>
        Every completion makes a round trip across the internet.
        <br />
        Thousands of tiny interruptions, every single day.
      </>
    ),
  },
]

function SurveillanceEye() {
  const rings = [220, 180, 140, 100, 60]
  const nodes = [
    [110, 90],
    [370, 90],
    [110, 390],
    [370, 390],
    [60, 180],
    [420, 180],
    [60, 300],
    [420, 300],
  ]

  return (
    <svg
      id="surveillance-eye"
      className="problem-eye-svg"
      viewBox="0 0 480 480"
      fill="none"
      aria-hidden="true"
    >
      <g className="eye-linework" opacity="0.22" stroke="#F0EDE6">
        {rings.map((radius) => (
          <circle key={radius} cx="240" cy="240" r={radius} strokeWidth="0.5" />
        ))}
        <path
          d="M240 0V480M0 240H480M70 70l340 340M410 70 70 410"
          strokeWidth="0.3"
        />
        <g className="eye-blink-target">
          <path
            d="M120 240s60-70 120-70 120 70 120 70-60 70-120 70-120-70-120-70Z"
            strokeWidth="1"
          />
          <circle cx="240" cy="240" r="35" strokeWidth="1" />
        </g>
        <path
          d="M40 70V40h30M410 40h30v30M440 410v30h-30M70 440H40v-30"
          strokeWidth="0.6"
        />
        <path
          d="M240 205 110 90M240 205 370 90M240 275 110 390M240 275 370 390M205 240 60 180M275 240l145-60M205 240 60 300M275 240l145 60"
          strokeWidth="0.25"
          strokeDasharray="3 6"
        />
        <path
          d="M240 240V60a180 180 0 0 1 140 85Z"
          fill="#F0EDE6"
          stroke="none"
          opacity="0.12"
        />
      </g>
      <g fill="#F0EDE6" opacity="0.5">
        {nodes.map(([cx, cy], index) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={index < 4 ? 3 : 2.5} />
        ))}
      </g>
      <text
        x="240"
        y="478"
        textAnchor="middle"
        fill="#F0EDE6"
        opacity="0.6"
        fontFamily="Chivo Mono"
        fontSize="5"
        letterSpacing="0.2em"
      >
        MONITORING ACTIVE
      </text>
      <text
        x="456"
        y="244"
        fill="#F0EDE6"
        opacity="0.4"
        fontFamily="Chivo Mono"
        fontSize="4"
        letterSpacing="0.15em"
        transform="rotate(90 465 240)"
      >
        TELEMETRY
      </text>
      <circle
        id="eye-pupil"
        className="eye-blink-target"
        cx="240"
        cy="240"
        r="14"
        fill="#ED462D"
      />
    </svg>
  )
}

export function ProblemSection() {
  return (
    <section className="signal-section problem-section" data-animate-section>
      <div className="problem-container container">
        <div className="problem-outer">
          <div className="problem-top">
            <Badge className="problem-badge" icon="problem">
              The problem
            </Badge>
            <h2 className="display problem-headline" data-reveal>
              You don&apos;t own your AI.
              <br />
              And you&apos;re being watched.
            </h2>
          </div>
          <div className="problem-divider" />
          <div className="problem-grid" data-stagger>
            <div className="problem-eye-col">
              <div className="problem-eye-wrapper">
                <SurveillanceEye />
              </div>
            </div>
            {problems.map((problem) => (
              <article className="problem-card" key={problem.number}>
                <div className="problem-card-header">
                  <span className="mono problem-card-label">
                    {problem.label}
                  </span>
                  <span className="mono problem-card-number">
                    {problem.number}
                  </span>
                </div>
                <h3 className="display-heavy">{problem.title}</h3>
                <p>{problem.body}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
