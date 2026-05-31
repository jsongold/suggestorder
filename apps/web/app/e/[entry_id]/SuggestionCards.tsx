"use client";

import type { SuggestedProduct } from "@/lib/api";

interface Props {
  suggestions: SuggestedProduct[];
  onAdd: (s: SuggestedProduct) => void;
}

export default function SuggestionCards({ suggestions, onAdd }: Props) {
  const items = suggestions.slice(0, 3);
  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400 px-1">
        AIのおすすめ
      </p>
      <div className="space-y-3">
        {items.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} onAdd={() => onAdd(s)} />
        ))}
      </div>
    </section>
  );
}

function SuggestionCard({
  suggestion,
  onAdd,
}: {
  suggestion: SuggestedProduct;
  onAdd: () => void;
}) {
  return (
    <article className="rounded-2xl border border-neutral-100 overflow-hidden bg-white shadow-sm">
      <div className="flex">
        <div className="w-24 h-24 flex-shrink-0 bg-neutral-100">
          {suggestion.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={suggestion.photo_url}
              alt={suggestion.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-neutral-100 via-neutral-50 to-neutral-200" />
          )}
        </div>
        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-neutral-900 truncate">
              {suggestion.name}
            </h3>
            <span className="text-sm font-semibold text-neutral-900 whitespace-nowrap">
              ¥{suggestion.price.toLocaleString()}
            </span>
          </div>
          {suggestion.reason && (
            <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed line-clamp-2">
              {suggestion.reason}
            </p>
          )}
          <button
            onClick={onAdd}
            className="mt-2 min-h-[36px] px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-semibold active:scale-95 transition-transform"
          >
            タブに追加
          </button>
        </div>
      </div>
    </article>
  );
}
