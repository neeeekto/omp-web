"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { WeeklyLimitAccount, WeeklyLimitsResponse } from "@/lib/weekly-limits";
import styles from "./WeeklyLimits.module.css";

interface WeeklyLimitsProps {
  refreshKey: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function remainingPercent(account: WeeklyLimitAccount): number | null {
  if (account.status !== "ready" || account.limits.some((limit) => limit.remainingPercent === null)) return null;
  return Math.min(...account.limits.map((limit) => limit.remainingPercent!));
}

function quotaColor(percent: number | null): string {
  if (percent === null) return "var(--text-muted)";
  return percent <= 10 ? "var(--danger)" : percent <= 25 ? "var(--warning)" : "var(--success)";
}

export function WeeklyLimits({ refreshKey, open, onToggle, onClose }: WeeklyLimitsProps) {
  const { t, locale } = useI18n();
  const visibleAccountCount = useIsMobile() ? 1 : 3;
  const [data, setData] = useState<WeeklyLimitsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const response = await fetch("/api/usage", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Usage unavailable");
        const next = await response.json() as WeeklyLimitsResponse;
        if (controller.signal.aborted) return;
        setData(next);
        setFailed(false);
      } catch {
        if (controller.signal.aborted) return;
        setData(null);
        setFailed(true);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshKey, reload]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 16);
      setPosition({ top: rect.bottom, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), width });
    };
    update();
    const observer = new ResizeObserver(update);
    if (rootRef.current) observer.observe(rootRef.current);
    window.addEventListener("resize", update);
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const accounts = data?.accounts ?? [];
  const formatPercent = (percent: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(percent)}%`;
  const formatDate = (timestamp: number) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-label={t("usage.title")}
        aria-expanded={open}
        aria-controls="weekly-limits-panel"
        title={t("usage.summaryHint")}
        onClick={onToggle}
      >
        <span className={styles.heading}>{t("usage.weekly")}</span>
        <span className={styles.summary}>
          {accounts.slice(0, visibleAccountCount).map((account) => {
            const percent = remainingPercent(account);
            return (
              <span key={account.id} className={styles.chip} title={`${account.provider} · ${account.label}`}>
                <span className={styles.provider}>{account.provider}</span>
                <span style={{ color: quotaColor(percent) }}>{percent === null ? "—" : formatPercent(percent)}</span>
              </span>
            );
          })}
          {accounts.length === 0 && <span>{loading ? "…" : "—"}</span>}
        </span>
        {accounts.length > visibleAccountCount && <span className={styles.heading}>+{accounts.length - visibleAccountCount}</span>}
      </button>
      {open && position && (
        <section id="weekly-limits-panel" aria-label={t("usage.title")} className={styles.panel} style={position}>
          <div className={styles.panelHeader}>
            <strong>{t("usage.title")}</strong>
            <button type="button" className={styles.action} disabled={loading} onClick={() => setReload((value) => value + 1)}>
              {t(loading ? "usage.loading" : "usage.refresh")}
            </button>
            <button type="button" className={styles.action} onClick={onClose} aria-label={t("usage.close")}>×</button>
          </div>
          <div className={styles.accounts} aria-busy={loading}>
            {failed && <p role="status" className={styles.message}>{t("usage.unavailable")}</p>}
            {!failed && !loading && accounts.length === 0 && <p className={styles.message}>{t("usage.empty")}</p>}
            {accounts.map((account) => (
              <div key={account.id} className={styles.account}>
                <div className={styles.accountName}>{account.label}</div>
                <div className={styles.subtitle}>{account.provider}</div>
                {account.status !== "ready" && <p className={styles.message}>{t(`usage.${account.status}`)}</p>}
                {account.limits.map((limit) => (
                  <div key={limit.id} className={styles.limit}>
                    <div className={styles.limitHeader}>
                      <span>{limit.label}</span>
                      <strong style={{ color: quotaColor(limit.remainingPercent) }}>
                        {limit.remainingPercent === null ? t("usage.unknown") : t("usage.remaining", { percent: formatPercent(limit.remainingPercent) })}
                      </strong>
                    </div>
                    {limit.remainingPercent !== null && (
                      <div className={styles.track} role="meter" aria-label={`${account.label} · ${limit.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={limit.remainingPercent} aria-valuetext={t("usage.remaining", { percent: formatPercent(limit.remainingPercent) })}>
                        <div style={{ width: `${limit.remainingPercent}%`, background: quotaColor(limit.remainingPercent) }} />
                      </div>
                    )}
                    {limit.resetsAt !== null && <div className={styles.subtitle}>{t("usage.resets", { date: formatDate(limit.resetsAt) })}</div>}
                  </div>
                ))}
                {account.fetchedAt !== null && <div className={styles.subtitle}>{t("usage.updated", { date: formatDate(account.fetchedAt) })}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
