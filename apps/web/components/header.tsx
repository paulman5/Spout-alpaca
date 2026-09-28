"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConfigBadge } from "./config-badge";
import { useT } from "@/lib/i18n";

export function Header() {
  const pathname = usePathname();
  const { t, lang, setLang, theme, setTheme } = useT();
  const links = [
    { href: "/", label: t("nav.orders") },
    { href: "/chaos", label: t("nav.chaos") },
  ];
  return (
    <header className="sx-header">
      <div className="sx-container sx-header-inner">
        <Link href="/" className="sx-wordmark" aria-label="Spout settlement console, home">
          <span className="sx-wordmark-name">Spout</span>
          <span className="sx-wordmark-suffix">Settlement</span>
        </Link>
        <nav className="sx-nav" aria-label="Sections">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" || pathname.startsWith("/orders") : pathname.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className="sx-nav-link" data-active={active ? "true" : undefined}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="sx-header-right">
          <ConfigBadge />
          <button className="sx-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Theme">
            {theme === "dark" ? t("nav.theme.light") : t("nav.theme.dark")}
          </button>
          <button className="sx-toggle" onClick={() => setLang(lang === "en" ? "fr" : "en")} title="Language">
            {t("nav.lang")}
          </button>
        </div>
      </div>
    </header>
  );
}
