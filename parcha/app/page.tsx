import {
  AnimationController,
  TextureOverlays,
} from "@/components/landing/animation-controller"
import { ApproachSection } from "@/components/landing/approach-section"
import { CapabilitiesSection } from "@/components/landing/capabilities-section"
import { EarlyAccess } from "@/components/landing/early-access"
import { FaqSection } from "@/components/landing/faq-section"
import { FinalCta, Footer } from "@/components/landing/footer-cta"
import { Hero } from "@/components/landing/hero"
import { LocalSections } from "@/components/landing/local-sections"
import { ProblemSection } from "@/components/landing/problem-section"
import { SectionDivider } from "@/components/landing/primitives"
import { TerminalSection } from "@/components/landing/terminal-section"

export default function Page() {
  return (
    <AnimationController>
      <TextureOverlays />
      <Hero />
      <div className="content-lines" aria-hidden="true" />
      <main className="content">
        <div className="opening-divider-wrap">
          <SectionDivider />
        </div>
        <ProblemSection />
        <SectionDivider />
        <LocalSections />
        <SectionDivider />
        <ApproachSection />
        <SectionDivider />
        <CapabilitiesSection />
        <TerminalSection />
        <SectionDivider />
        <EarlyAccess />
        <SectionDivider />
        <FaqSection />
        <SectionDivider />
        <div className="closing-divider-wrap">
          <SectionDivider />
        </div>
      </main>
      <FinalCta />
      <Footer />
    </AnimationController>
  )
}
