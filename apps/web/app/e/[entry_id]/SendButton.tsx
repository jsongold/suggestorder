"use client";

interface Props {
  disabled: boolean;
  loading: boolean;
  total: number;
  onClick: () => void;
}

export default function SendButton({ disabled, loading, total, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full min-h-[52px] rounded-2xl bg-neutral-900 text-white shadow-[0_8px_30px_rgba(0,0,0,0.3)] border border-white/10 px-5 py-3.5 flex items-center justify-between disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
    >
      <span className="font-semibold text-[15px]">
        {loading ? "送信中..." : "ご注文を送信"}
      </span>
      <span className="font-semibold text-[15px]">
        ¥{total.toLocaleString()}
      </span>
    </button>
  );
}
