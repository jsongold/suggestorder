"use client";

import { useMemo, useState } from "react";

import type { Product } from "@/lib/api";

interface Props {
  products: Product[];
  onAdd: (product: Product) => void;
}

export default function MenuList({ products, onAdd }: Props) {
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return Array.from(set);
  }, [products]);

  const [active, setActive] = useState<string>("all");

  const filtered = useMemo(() => {
    if (active === "all") return products;
    return products.filter((p) => p.category === active);
  }, [products, active]);

  if (products.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-bold text-neutral-900 mb-2 px-1">
          メニュー
        </h2>
        <p className="py-10 text-center text-sm text-neutral-400">
          メニューがまだ登録されていません
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-bold text-neutral-900 mb-2 px-1">メニュー</h2>

      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
          <Chip
            label="すべて"
            active={active === "all"}
            onClick={() => setActive("all")}
          />
          {categories.map((c) => (
            <Chip
              key={c}
              label={c}
              active={active === c}
              onClick={() => setActive(c)}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mt-2">
        {filtered.map((p) => (
          <ProductCard key={p.id} product={p} onAdd={() => onAdd(p)} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-400">
          このカテゴリには商品がありません
        </p>
      )}
    </section>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap min-h-[36px] px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
        active
          ? "bg-neutral-900 text-white"
          : "bg-white text-neutral-700 border border-neutral-200"
      }`}
    >
      {label}
    </button>
  );
}

function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: () => void;
}) {
  const disabled = !product.is_available;
  return (
    <div className="relative bg-white rounded-2xl overflow-hidden border border-neutral-100 shadow-sm">
      <div className="relative aspect-[4/3] w-full bg-neutral-100">
        {product.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.photo_url}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-neutral-100 via-neutral-50 to-neutral-200" />
        )}
        {disabled && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <span className="text-[11px] font-semibold text-neutral-600 bg-white rounded-full px-2 py-1 border border-neutral-200">
              品切れ
            </span>
          </div>
        )}
      </div>
      <div className="p-3 pb-12">
        <h3 className="text-sm font-bold text-neutral-900 leading-snug line-clamp-2">
          {product.name}
        </h3>
        <div className="mt-1 text-[15px] font-semibold text-neutral-900">
          ¥{product.price.toLocaleString()}
        </div>
      </div>
      <button
        onClick={onAdd}
        disabled={disabled}
        aria-label="タブに追加"
        className="absolute bottom-3 right-3 w-11 h-11 rounded-full bg-neutral-900 text-white flex items-center justify-center shadow-lg active:scale-90 transition-transform disabled:bg-neutral-300"
      >
        <PlusIcon />
      </button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
