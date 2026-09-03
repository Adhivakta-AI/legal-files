import styles from "./page-skeletons.module.css"

function Line({
  width = "100%",
  className = "",
}: {
  width?: string
  className?: string
}) {
  return (
    <div
      className={`${styles.line} ${className}`}
      style={{ width }}
      aria-hidden="true"
    />
  )
}

function Bar({ width = "100%" }: { width?: string }) {
  return <div className={styles.bar} style={{ width }} aria-hidden="true" />
}

function Chrome({ context = true }: { context?: boolean }) {
  return (
    <header className={styles.chrome}>
      <div className={styles.brand}>
        <div className={styles.mark} aria-hidden="true" />
        <div className={styles.brandCopy}>
          <Line width="128px" />
          <Line width="190px" />
        </div>
      </div>
      {context ? (
        <div className={styles.context} aria-hidden="true">
          <div className={styles.chip} />
          <Line width="132px" />
        </div>
      ) : null}
      <nav className={styles.nav} aria-hidden="true">
        <div className={styles.chip} />
        <div className={styles.chip} />
        <div className={styles.chip} />
      </nav>
      <div className={styles.avatar} aria-hidden="true" />
    </header>
  )
}

function BrowseCards({ count = 7 }: { count?: number }) {
  return (
    <div className={styles.resultList} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <article className={styles.resultCard} key={index}>
          <Line width="72%" />
          <Line width="46%" />
          <div className={styles.landingActions}>
            <div className={styles.chip} />
            <div className={styles.chip} />
            <div className={styles.chip} />
          </div>
          <Line width="58%" />
        </article>
      ))}
    </div>
  )
}

function Facets() {
  return (
    <aside className={styles.rail} aria-hidden="true">
      <Line width="120px" />
      {Array.from({ length: 6 }, (_, index) => (
        <div className={styles.facetSkeleton} key={index}>
          <Line width="64%" />
          <Line width="88%" />
          <Line width="72%" />
          <Line width="80%" />
        </div>
      ))}
    </aside>
  )
}

export function BrowsePageSkeleton() {
  return (
    <div className={styles.page} role="status" aria-label="Loading browse">
      <Chrome />
      <main className={`${styles.shell} ${styles.browseShell}`}>
        <Facets />
        <section className={styles.content}>
          <div className={styles.resultHeader} aria-hidden="true">
            <Line width="220px" />
            <div style={{ marginLeft: "auto" }}>
              <Bar width="150px" />
            </div>
          </div>
          <BrowseCards />
        </section>
      </main>
    </div>
  )
}

export function BrowseInlineResultsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className={styles.inlineResults}
      role="status"
      aria-label="Loading results"
    >
      {Array.from({ length: count }, (_, index) => (
        <article className={styles.inlineCard} key={index}>
          <Line width="76%" />
          <Line width="42%" />
          <div className={styles.landingActions}>
            <div className={styles.chip} />
            <div className={styles.chip} />
            <div className={styles.chip} />
          </div>
        </article>
      ))}
    </div>
  )
}

export function ResearchPageSkeleton() {
  return (
    <div className={styles.page} role="status" aria-label="Loading research">
      <Chrome />
      <main className={`${styles.shell} ${styles.researchShell}`}>
        <aside className={styles.sidePanel} aria-hidden="true">
          <Bar />
          {Array.from({ length: 5 }, (_, index) => (
            <div className={styles.answerCard} key={index}>
              <Line width="92%" />
              <Line width="58%" />
            </div>
          ))}
        </aside>
        <section className={styles.answerMain}>
          <div className={styles.composerShell} aria-hidden="true">
            <Line width="170px" />
            <Line width="62%" />
            <Line width="42%" />
            <div className={styles.composerBox}>
              <div className={styles.block} />
              <div className={styles.landingActions}>
                <Bar width="132px" />
                <Bar width="132px" />
                <Bar width="160px" />
              </div>
            </div>
          </div>
        </section>
        <aside className={styles.pipeline} aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div className={styles.pipelineStep} key={index}>
              <Line width="60%" />
              <Line width="90%" />
            </div>
          ))}
        </aside>
      </main>
    </div>
  )
}

export function ResearchRunSkeleton() {
  return (
    <div
      className={styles.inlineAnswer}
      role="status"
      aria-label="Loading answer"
    >
      <Line width="72%" />
      <Line width="96%" />
      <Line width="88%" />
      <Line width="92%" />
      <Line width="63%" />
    </div>
  )
}

export function AuthPageSkeleton() {
  return (
    <main
      className={`${styles.page} ${styles.authPage}`}
      role="status"
      aria-label="Loading account form"
    >
      <header className={styles.authHeader} aria-hidden="true">
        <div className={styles.landingActions}>
          <div className={styles.mark} />
          <Line width="132px" />
        </div>
        <Line width="94px" />
      </header>
      <section className={styles.authStage}>
        <div className={styles.authCard} aria-hidden="true">
          <Line width="150px" />
          <Line width="76%" />
          <Line width="92%" />
          <Bar />
          <Bar />
          <Bar width="58%" />
        </div>
      </section>
    </main>
  )
}

export function LandingPageSkeleton() {
  return (
    <main
      className={`${styles.page} ${styles.landingHero}`}
      role="status"
      aria-label="Loading home"
    >
      <header className={styles.landingNav} aria-hidden="true">
        <Line width="88px" />
        <div className={styles.landingActions}>
          <div className={styles.chip} />
          <div className={styles.chip} />
          <div className={styles.chip} />
        </div>
      </header>
      <section className={styles.landingContent} aria-hidden="true">
        <Line width="68%" />
        <Line width="58%" />
        <Line width="42%" />
        <div className={styles.landingActions}>
          <Bar width="150px" />
          <Bar width="150px" />
        </div>
      </section>
      <footer className={styles.landingTicker} aria-hidden="true">
        <Line width="180px" />
        <Line width="140px" />
        <Line width="220px" />
        <Line width="160px" />
      </footer>
    </main>
  )
}

export function JudgmentPageSkeleton() {
  return (
    <main
      className={`${styles.page} ${styles.readerPage}`}
      role="status"
      aria-label="Loading judgment"
    >
      <header className={styles.readerToolbar} aria-hidden="true">
        <Bar width="96px" />
        <Bar width="104px" />
        <Line width="46%" />
        <div style={{ marginLeft: "auto" }}>
          <Bar width="76px" />
        </div>
      </header>
      <section className={styles.readerBody}>
        <aside className={styles.readerPanel} aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div className={styles.pipelineStep} key={index}>
              <Line width="36%" />
              <Line width="94%" />
              <Line width="68%" />
            </div>
          ))}
        </aside>
        <div className={styles.viewer} aria-hidden="true">
          <div
            className={styles.card}
            style={{ width: "min(560px, 76%)", height: "72%" }}
          />
        </div>
      </section>
    </main>
  )
}
