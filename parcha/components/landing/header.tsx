"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"

export function Header() {
  const [open, setOpen] = useState(false)
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
        <a href="#top" className="site-logo" aria-label="Rig — Home">
          <Image
            src="/assets/brand/rig-wordmark.svg"
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
          onClick={() => setOpen((value) => !value)}
        >
          <span className="nav-toggle-bar" />
          <span className="nav-toggle-bar" />
          <span className="nav-toggle-bar" />
        </button>
        <ul className="site-nav-links" id="nav-menu" data-open={open}>
          <li>
            <Link href="/blog" onClick={() => setOpen(false)}>
              Blog
            </Link>
          </li>
          <li>
            <Link href="/research" onClick={() => setOpen(false)}>
              Research
            </Link>
          </li>
          <li>
            <Link
              href="/research"
              className="btn-chamfer site-nav-cta btn-dark"
              onClick={() => setOpen(false)}
            >
              Open Lex
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  )
}
