"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { useLandingUiStore } from "./store/landing-ui-store"

export function Header() {
  const open = useLandingUiStore((state) => state.mobileNavOpen)
  const toggleOpen = useLandingUiStore((state) => state.toggleMobileNav)
  const closeOpen = useLandingUiStore((state) => state.closeMobileNav)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  useGSAP(
    () => {
      if (!open) return
      gsap.fromTo(
        ".site-nav-links li",
        { autoAlpha: 0, y: 18 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.45,
          stagger: 0.08,
          ease: "power3.out",
        }
      )
    },
    { scope: navRef, dependencies: [open], revertOnUpdate: true }
  )

  return (
    <header className="site-header" data-variant="hero" role="banner">
      <nav ref={navRef} className="site-nav" aria-label="Main navigation">
        <a href="#top" className="site-logo" aria-label="Lex — Home">
          <Image
            src="/assets/brand/lex-wordmark.svg"
            alt=""
            width={60}
            height={22}
            style={{ width: "auto" }}
            priority
          />
        </a>
        <button
          className="nav-toggle"
          aria-expanded={open}
          aria-controls="nav-menu"
          aria-label="Toggle navigation"
          type="button"
          onClick={toggleOpen}
        >
          <span className="nav-toggle-bar" />
          <span className="nav-toggle-bar" />
          <span className="nav-toggle-bar" />
        </button>
        <ul className="site-nav-links" id="nav-menu" data-open={open}>
          <li>
            <Link href="/blog" onClick={closeOpen}>
              Blog
            </Link>
          </li>
          <li>
            <Link href="/research" onClick={closeOpen}>
              Research
            </Link>
          </li>
          <li>
            <Link
              href="/research"
              className="btn-chamfer site-nav-cta btn-dark"
              onClick={closeOpen}
            >
              Open Lex
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  )
}
