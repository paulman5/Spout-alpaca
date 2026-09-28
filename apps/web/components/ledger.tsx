"use client";

import Link from "next/link";
import type { OrderEventView } from "@spout/shared";
import type { LedgerRow } from "@/lib/api";
import { explorerTx, short } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { explainActor, explainReason } from "@/lib/reasons";
import { StatusChip } from "./ui";

function reasonTone(reason: string): "seal" | "warn" | "quiet" | undefined {
  if (/3012|already|recovered|reconciled|confirmed|filled|accepted/.test(reason)) return "seal";
  if (/rejected|exhausted|needs_human|failed|drift|cap|while_refunding/.test(reason)) return "warn";
  if (/retry|duplicate|recheck|ingested|chain_event|signed|scheduled|requested/.test(reason)) return "quiet";
  return undefined;
}

/** Legacy export kept for the feed. */
export function shortActor(actor: string): string {
  return explainActor(actor, "en");
}

const SIGNATURE_KEYS = new Set(["signature", "attemptedSignature", "landedSignature", "settleSignature"]);
const HIDE_KEYS = new Set(["source", "previous"]);

function Detail({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined || v === "") return null;
  const text = typeof v === "object" ? JSON.stringify(v) : String(v);
  const isSig = SIGNATURE_KEYS.has(k) && text.length > 40;
  return (
    <span className="sx-detail">
      <span className="sx-detail-k">{k}</span>
      {isSig ? (
        <a href={explorerTx(text)} target="_blank" rel="noreferrer" className="sx-link" title={text}>
          {short(text, 6)}
        </a>
      ) : (
        <span title={text.length > 48 ? text : undefined}>{text.length > 48 ? `${text.slice(0, 45)}…` : text}</span>
      )}
    </span>
  );
}

function Details({ details }: { details: Record<string, unknown> | null }) {
  if (!details) return null;
  const entries = Object.entries(details).filter(([k, v]) => !HIDE_KEYS.has(k) && v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return null;
  return (
    <div className="sx-details-row">
      {entries.map(([k, v]) => (
        <Detail key={k} k={k} v={v} />
      ))}
    </div>
  );
}

export function LedgerTimeline({ events }: { events: OrderEventView[] }) {
  const { lang } = useT();
  return (
    <ol className="sx-ledger">
      {events.map((e) => {
        const change = e.fromStatus !== e.toStatus;
        const explanation = explainReason(e.reason, lang);
        return (
          <li key={e.id} className="sx-ledger-row" data-change={change ? "true" : undefined}>
            <span className="sx-ledger-time">{e.createdAt.slice(11, 19)}</span>
            <span className="sx-ledger-transition">
              {change ? (
                <>
                  <StatusChip status={e.fromStatus ?? "—"} pulse={false} />
                  <span style={{ color: "var(--faint)" }}>→</span>
                  <StatusChip status={e.toStatus} pulse={false} />
                </>
              ) : (
                <StatusChip status={e.toStatus} pulse={false} />
              )}
            </span>
            <span className="sx-ledger-text">
              <span className="sx-ledger-explain">{explanation ?? e.reason}</span>
              {explanation && (
                <span className="sx-reason" data-tone={reasonTone(e.reason)}>
                  {e.reason}
                </span>
              )}
              <Details details={e.details} />
            </span>
            <span className="sx-ledger-actor" title={e.actor}>
              {explainActor(e.actor, lang)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function LiveFeed({ events }: { events: LedgerRow[] }) {
  const { t, lang } = useT();
  if (events.length === 0) return <p className="sx-note">{t("feed.waiting")}</p>;
  return (
    <ul className="sx-feed">
      {events.map((e) => (
        <li key={e.id} className="sx-feed-row">
          <div className="sx-feed-head">
            <span className="sx-ledger-time">{e.createdAt.slice(11, 19)}</span>
            <Link href={`/orders/${e.userPubkey}/${e.orderId}`} className="sx-link sx-mono" style={{ color: "var(--paper)", fontSize: "0.75rem" }}>
              {e.orderId}
            </Link>
            {e.fromStatus !== e.toStatus ? <StatusChip status={e.toStatus} pulse={false} /> : null}
            <span className="sx-ledger-actor" style={{ marginLeft: "auto" }} title={e.actor}>
              {explainActor(e.actor, lang)}
            </span>
          </div>
          <p className="sx-feed-text">{explainReason(e.reason, lang) ?? e.reason}</p>
        </li>
      ))}
    </ul>
  );
}
