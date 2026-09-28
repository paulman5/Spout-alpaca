"use client";

import { useEffect, useState } from "react";
import { api, short } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Config {
  broker: string;
  wallet: string;
  programId: string;
  rpcUrl: string;
}

export function ConfigBadge() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [err, setErr] = useState(false);
  const { t } = useT();
  useEffect(() => {
    api<Config>("/config")
      .then(setCfg)
      .catch(() => setErr(true));
  }, []);
  if (err) {
    return (
      <span className="sx-chip" data-tone="warn">
        <span className="sx-dot" data-tone="warn" /> {t("cfg.offline")}
      </span>
    );
  }
  if (!cfg) return null;
  return (
    <>
      <span className="sx-chip" data-tone={cfg.broker === "alpaca" ? "done" : "quiet"} title={cfg.rpcUrl}>
        <span className="sx-dot" data-tone={cfg.broker === "alpaca" ? undefined : "quiet"} />
        {t("cfg.broker")} · {cfg.broker}
      </span>
      <span className="sx-chip" data-tone="quiet" title={cfg.wallet}>
        devnet · {short(cfg.wallet, 4)}
      </span>
    </>
  );
}
