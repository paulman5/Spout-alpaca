"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderEventView, OrderView } from "@spout/shared";

/**
 * API base URL. Build-time default from NEXT_PUBLIC_API_URL; can be overridden at
 * runtime with `?api=https://...` (persisted in localStorage) so one deployed
 * console can point at any backend during a demo.
 */
export const API_URL = resolveApiUrl();

function resolveApiUrl(): string {
  const fallback = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  if (typeof window === "undefined") return fallback;
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("api");
    if (fromQuery) {
      const clean = fromQuery.replace(/\/+$/, "");
      window.localStorage.setItem("spout.api", clean);
      return clean;
    }
    return window.localStorage.getItem("spout.api") ?? fallback;
  } catch {
    return fallback;
  }
}

export interface AlertView {
  id: string;
  userPubkey: string | null;
  orderId: string | null;
  severity: "warning" | "critical";
  message: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface LedgerRow extends OrderEventView {
  userPubkey: string;
  orderId: string;
}

export interface StreamSnapshot {
  orders: OrderView[];
  events: LedgerRow[];
  alerts: AlertView[];
}

/** Optional admin token (`?token=...` or the Access card, persisted) for the ops/chaos endpoints when the API sets ADMIN_TOKEN. */
function adminToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("token");
    if (q) window.localStorage.setItem("spout.token", q);
    return window.localStorage.getItem("spout.token");
  } catch {
    return null;
  }
}

export function getAdminToken(): string | null {
  return adminToken();
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem("spout.token", token.trim());
    else window.localStorage.removeItem("spout.token");
  } catch {
    /* ignore */
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const token = adminToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) },
    cache: "no-store",
    ...init,
  });
  const text = await res.text();
  if (res.status === 401) {
    throw new Error("Admin token required. Paste it in the Access card at the top of the Chaos lab page (it is remembered in this browser).");
  }
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

/** Live snapshot from the API's SSE stream, with a polling fallback. */
export function useStream(): { data: StreamSnapshot | null; connected: boolean; error: string | null } {
  const [data, setData] = useState<StreamSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    const es = new EventSource(`${API_URL}/stream`);
    esRef.current = es;
    es.onopen = () => {
      setConnected(true);
      setError(null);
    };
    es.onmessage = (m) => {
      if (cancelled) return;
      try {
        setData(JSON.parse(m.data) as StreamSnapshot);
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      setConnected(false);
      setError(`cannot reach ${API_URL}`);
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  return { data, connected, error };
}

export function explorerTx(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
export function explorerAddress(addr: string) {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}
export function short(s: string | null | undefined, n = 6) {
  if (!s) return "—";
  return s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
}
export function usdc(amount: string | null | undefined) {
  if (!amount) return "—";
  return `$${(Number(amount) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
