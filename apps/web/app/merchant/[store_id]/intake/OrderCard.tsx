"use client";

import { useEffect, useState } from "react";
import StatusButtons from "./StatusButtons";
import type {
  IntakeOrder,
  OrderLineItem,
  OrderStatus,
} from "./useOrderPolling";

interface OrderCardProps {
  order: IntakeOrder;
  pending: boolean;
  onAdvance: (next: OrderStatus) => void;
  onCancel: () => void;
  onTogglePayment: () => void;
}

export default function OrderCard({
  order,
  pending,
  onAdvance,
  onCancel,
  onTogglePayment,
}: OrderCardProps) {
  const payload = order.payload ?? {};
  const entryLabel = payload.entry?.label ?? "—";
  const entryKind = payload.entry?.kind;
  const lineItems: OrderLineItem[] = payload.line_items ?? [];
  const total = payload.totals?.total?.amount ?? sumLineItems(lineItems);
  const currency = payload.totals?.total?.currency ?? "JPY";
  const aiAssisted = !!payload.cart_source?.ai_assisted;
  const aiTags = payload.cart_source?.inquiry_tags ?? [];

  const status = order.status;
  const paymentStatus = order.payment_status;

  const receivedAt = payload.closed_at ?? order.created_at;
  const elapsed = useElapsed(receivedAt);

  return (
    <article
      className={`rounded-2xl border-2 bg-white shadow-sm overflow-hidden flex flex-col ${statusBorderClass(
        status
      )}`}
    >
      <header className={`px-5 py-4 ${statusHeaderClass(status)}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest opacity-80">
              {kindLabel(entryKind)}
            </p>
            <h2 className="text-3xl font-bold leading-tight truncate">
              {entryLabel}
            </h2>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs opacity-80">経過</div>
            <div className="text-2xl font-bold tabular-nums">{elapsed}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          <PaymentBadge
            status={paymentStatus}
            onClick={onTogglePayment}
            disabled={pending}
          />
          {aiAssisted && <AiBadge tags={aiTags} />}
        </div>
      </header>

      <div className="px-5 py-4 flex-1">
        <ul className="space-y-3">
          {lineItems.map((li) => (
            <li
              key={li.line_id}
              className="flex items-start gap-3 pb-3 border-b border-neutral-100 last:border-b-0 last:pb-0"
            >
              <span className="shrink-0 inline-flex items-center justify-center min-w-[2.25rem] h-9 px-2 rounded-full bg-neutral-900 text-white text-sm font-bold tabular-nums">
                ×{li.quantity}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-base font-bold text-neutral-900 leading-snug">
                    {li.name}
                  </h3>
                  <span className="text-sm font-semibold text-neutral-700 tabular-nums whitespace-nowrap">
                    {formatAmount(li.subtotal?.amount, li.subtotal?.currency)}
                  </span>
                </div>
                {li.modifiers && li.modifiers.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {li.modifiers.map((m, idx) => (
                      <li
                        key={`${m.modifier_id}-${idx}`}
                        className="text-xs text-neutral-600"
                      >
                        + {m.name}
                        {m.price_delta && m.price_delta.amount !== 0 && (
                          <span className="ml-1 text-neutral-400">
                            (
                            {m.price_delta.amount > 0 ? "+" : ""}
                            {formatAmount(
                              m.price_delta.amount,
                              m.price_delta.currency
                            )}
                            )
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {li.note && (
                  <p className="mt-1 inline-block text-[12px] font-medium text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    メモ: {li.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {lineItems.length === 0 && (
          <p className="py-6 text-center text-sm text-neutral-400">
            明細データがありません
          </p>
        )}
      </div>

      <div className="px-5 py-3 bg-neutral-50 border-t border-neutral-100 flex items-baseline justify-between">
        <span className="text-sm font-medium text-neutral-500">合計</span>
        <span className="text-2xl font-bold text-neutral-900 tabular-nums">
          {formatAmount(total, currency)}
        </span>
      </div>

      <footer className="px-5 py-4 border-t border-neutral-100">
        <StatusButtons
          current={status}
          pending={pending}
          onAdvance={onAdvance}
          onCancel={onCancel}
        />
      </footer>
    </article>
  );
}

/* ---------- subcomponents ---------- */

function StatusBadge({ status }: { status: OrderStatus }) {
  const map: Record<OrderStatus, { label: string; cls: string }> = {
    received: { label: "受信", cls: "bg-blue-100 text-blue-800 border-blue-200" },
    preparing: {
      label: "調理中",
      cls: "bg-amber-100 text-amber-900 border-amber-200",
    },
    ready: {
      label: "完成",
      cls: "bg-emerald-100 text-emerald-800 border-emerald-200",
    },
    handed: { label: "お渡し済", cls: "bg-neutral-200 text-neutral-700 border-neutral-300" },
    canceled: { label: "キャンセル", cls: "bg-red-100 text-red-700 border-red-200" },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${cls}`}
    >
      {label}
    </span>
  );
}

function PaymentBadge({
  status,
  onClick,
  disabled,
}: {
  status: IntakeOrder["payment_status"];
  onClick: () => void;
  disabled: boolean;
}) {
  const isPaid = status === "paid";
  const cls = isPaid
    ? "bg-white text-emerald-700 border-emerald-400 hover:bg-emerald-50"
    : "bg-red-600 text-white border-red-700 hover:bg-red-700";
  const label = isPaid ? "支払済" : "未払い";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${cls}`}
      title="タップで支払い状態を切り替え"
    >
      {label}
    </button>
  );
}

function AiBadge({ tags }: { tags: string[] }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-violet-100 text-violet-800 border border-violet-200"
      title={tags.join(", ")}
    >
      AI
      {tags.length > 0 && (
        <span className="font-medium opacity-80">
          · {tags.slice(0, 3).join(" / ")}
          {tags.length > 3 && " +"}
        </span>
      )}
    </span>
  );
}

/* ---------- helpers ---------- */

function sumLineItems(items: OrderLineItem[]): number {
  return items.reduce((sum, li) => sum + (li.subtotal?.amount ?? 0), 0);
}

function formatAmount(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined || amount === null) return "—";
  if (currency && currency !== "JPY") {
    return `${amount.toLocaleString()} ${currency}`;
  }
  return `¥${amount.toLocaleString()}`;
}

function kindLabel(kind: string | undefined): string {
  switch (kind) {
    case "dine_in":
      return "イートイン";
    case "takeout":
      return "テイクアウト";
    case "delivery":
      return "デリバリー";
    case "counter":
      return "カウンター";
    default:
      return "注文";
  }
}

function statusBorderClass(status: OrderStatus): string {
  switch (status) {
    case "received":
      return "border-blue-400";
    case "preparing":
      return "border-amber-400";
    case "ready":
      return "border-emerald-500";
    default:
      return "border-neutral-200";
  }
}

function statusHeaderClass(status: OrderStatus): string {
  switch (status) {
    case "received":
      return "bg-blue-600 text-white";
    case "preparing":
      return "bg-amber-500 text-amber-950";
    case "ready":
      return "bg-emerald-600 text-white";
    default:
      return "bg-neutral-200 text-neutral-800";
  }
}

/** Returns a live-updating "Xm Ys" string since the given ISO timestamp. */
function useElapsed(iso: string | undefined): string {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return "—";
  const startMs = Date.parse(iso);
  if (Number.isNaN(startMs)) return "—";
  const totalSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
