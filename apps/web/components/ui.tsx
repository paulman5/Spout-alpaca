"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Panel with a serif title and a mono meta line, hairline rules, no radius. */
export function Panel({ title, meta, children, className }: { title?: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`sx-panel ${className ?? ""}`}>
      {(title || meta) && (
        <header className="sx-panel-head">
          <h2 className="sx-panel-title">{title}</h2>
          {meta && <span className="sx-panel-meta">{meta}</span>}
        </header>
      )}
      <div className="sx-panel-body">{children}</div>
    </section>
  );
}

type Variant = "primary" | "ghost" | "warn";
export function Button({ variant = "ghost", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const cls = variant === "primary" ? "sx-btn" : variant === "warn" ? "sx-btn-warn" : "sx-btn-ghost";
  return <button className={`${cls} ${className ?? ""}`} {...rest} />;
}

const TERMINAL = ["settled", "refunded", "needs_human"];
export function statusTone(status: string): "live" | "done" | "warn" | "quiet" {
  if (status === "needs_human") return "warn";
  if (status === "settled") return "done";
  if (status === "refunded") return "quiet";
  return "live";
}

/** Status chip: cyan seal for settled, pulsing paper for in flight, amber for needs_human, faint for refunded. */
export function StatusChip({ status, pulse = true }: { status: string; pulse?: boolean }) {
  const tone = statusTone(status);
  const dotTone = tone === "live" ? (pulse ? "live" : "quiet") : tone === "done" ? undefined : tone;
  return (
    <span className="sx-chip" data-tone={tone}>
      <span className="sx-dot" data-tone={dotTone} aria-hidden="true" />
      {status.replace("_", " ")}
    </span>
  );
}

export function isTerminal(status: string) {
  return TERMINAL.includes(status);
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="sx-card">
      <p className="sx-card-label">{label}</p>
      <p className="sx-card-value">{value}</p>
      {note && <p className="sx-card-note">{note}</p>}
    </div>
  );
}

export function ExternalLink({ href, children, mono = true }: { href: string; children: ReactNode; mono?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`sx-link ${mono ? "sx-mono" : ""}`} style={mono ? { color: "var(--paper)" } : undefined}>
      {children}
    </a>
  );
}

/** Keyed row with leader dots, as in a printed report. */
export function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="sx-row">
      <span className="sx-row-key">{k}</span>
      <span className="sx-row-lead" aria-hidden="true" />
      <span className="sx-row-val">{children}</span>
    </div>
  );
}
