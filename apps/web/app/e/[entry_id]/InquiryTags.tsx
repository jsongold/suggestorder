"use client";

import type { InquiryOptions } from "@/lib/api";

interface Props {
  options: InquiryOptions | null;
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

export default function InquiryTags({
  options,
  selectedTags,
  onToggleTag,
  onSubmit,
  loading,
}: Props) {
  const tags = options?.tags ?? [];

  return (
    <section className="rounded-2xl bg-white border border-neutral-100 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <SparkIcon />
        <h2 className="text-sm font-bold text-neutral-900">
          今日の気分は？
        </h2>
      </div>
      <p className="text-[11px] text-neutral-500 mb-3">
        タグを選ぶとAIがおすすめを提案します
      </p>

      {tags.length === 0 ? (
        <p className="text-[12px] text-neutral-400 py-2">
          {loading ? "読み込み中..." : "タグを準備中..."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          {tags.map((tag) => {
            const selected = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => onToggleTag(tag)}
                className={`min-h-[36px] px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
                  selected
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-700"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={loading || selectedTags.length === 0}
        className="w-full min-h-[44px] py-2.5 rounded-xl bg-neutral-900 text-white font-semibold text-[14px] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
      >
        {loading ? "考え中..." : "提案を見る"}
      </button>
    </section>
  );
}

function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2zm7 11l.9 2.6L22.5 17l-2.6.9L19 20.5l-.9-2.6L15.5 17l2.6-.9L19 13z" />
    </svg>
  );
}
