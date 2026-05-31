"use client";

import type { OrderStatus } from "./useOrderPolling";

interface StatusButtonsProps {
  current: OrderStatus;
  pending: boolean;
  onAdvance: (next: OrderStatus) => void;
  onCancel: () => void;
}

/**
 * Forward-only status controls: 調理開始 → 完成 → お渡し済.
 * `canceled` is always reachable from any non-terminal state.
 *
 * Skipping forward (e.g. received → ready for cold drinks) is allowed by the
 * state machine, so we render every still-applicable forward step as a button
 * — the merchant can tap whichever one matches reality.
 */
export default function StatusButtons({
  current,
  pending,
  onAdvance,
  onCancel,
}: StatusButtonsProps) {
  const steps: Array<{ next: OrderStatus; label: string; tone: ButtonTone }> = [];
  if (current === "received") {
    steps.push({ next: "preparing", label: "調理開始", tone: "yellow" });
    steps.push({ next: "ready", label: "完成", tone: "green" });
    steps.push({ next: "handed", label: "お渡し済", tone: "dark" });
  } else if (current === "preparing") {
    steps.push({ next: "ready", label: "完成", tone: "green" });
    steps.push({ next: "handed", label: "お渡し済", tone: "dark" });
  } else if (current === "ready") {
    steps.push({ next: "handed", label: "お渡し済", tone: "dark" });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((s) => (
        <button
          key={s.next}
          type="button"
          disabled={pending}
          onClick={() => onAdvance(s.next)}
          className={`flex-1 min-w-[120px] min-h-[60px] rounded-xl text-base font-bold transition-transform active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${toneClass(
            s.tone
          )}`}
        >
          {s.label}
        </button>
      ))}
      <button
        type="button"
        disabled={pending}
        onClick={onCancel}
        className="min-w-[100px] min-h-[60px] px-4 rounded-xl text-sm font-semibold border border-red-200 text-red-700 bg-white hover:bg-red-50 active:scale-[0.97] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
      >
        キャンセル
      </button>
    </div>
  );
}

type ButtonTone = "yellow" | "green" | "dark";

function toneClass(tone: ButtonTone): string {
  switch (tone) {
    case "yellow":
      return "bg-amber-400 text-amber-950 hover:bg-amber-500";
    case "green":
      return "bg-emerald-500 text-white hover:bg-emerald-600";
    case "dark":
      return "bg-neutral-900 text-white hover:bg-black";
  }
}
