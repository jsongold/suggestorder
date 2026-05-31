"use client";

import { useState } from "react";

import type { Tab } from "@/lib/api";

interface Props {
  tab: Tab | null;
  onRemove: (itemId: string) => void;
}

export default function TabView({ tab, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false);
  const items = tab?.items ?? [];
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const total = tab?.totals.total ?? 0;

  if (count === 0) return null;

  return (
    <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.15)] border border-neutral-100 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 min-h-[48px]"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-full bg-neutral-900 text-white flex items-center justify-center text-xs font-bold">
            {count}
          </span>
          <span className="font-semibold text-[14px] text-neutral-900">
            タブ
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-semibold text-[14px] text-neutral-900">
            ¥{total.toLocaleString()}
          </span>
          <span
            className={`text-neutral-400 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            aria-hidden
          >
            ▾
          </span>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-neutral-100 max-h-[40vh] overflow-y-auto">
          <ul className="divide-y divide-neutral-100">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-neutral-900 truncate">
                    {item.name}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {item.quantity} × ¥{item.unit_price.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-neutral-900 whitespace-nowrap">
                    ¥{item.subtotal.toLocaleString()}
                  </span>
                  <button
                    onClick={() => onRemove(item.id)}
                    aria-label="削除"
                    className="min-w-[36px] min-h-[36px] w-9 h-9 rounded-full bg-neutral-100 text-neutral-500 flex items-center justify-center active:scale-90 transition-transform"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 border-t border-neutral-100 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-neutral-600">
              合計
            </span>
            <span className="text-base font-bold text-neutral-900">
              ¥{total.toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
