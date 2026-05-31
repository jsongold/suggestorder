"use client";

import { useEffect, useState, use, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import AiCatalogChat from "./AiCatalogChat";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Product {
  id: string;
  store_id: string;
  name: string;
  price: number;
  photo_url: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  attributes: Record<string, unknown>;
  is_available: boolean;
  enriched_at: string | null;
  created_at: string;
}

export default function AdminStorePage({
  params,
}: {
  params: Promise<{ org_id: string; store_id: string }>;
}) {
  const { org_id, store_id } = use(params);
  const router = useRouter();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSupabaseEnabled) {
      supabase!.auth.getSession().then(({ data: { session } }) => {
        if (!session) {
          router.push("/admin");
          return;
        }
        setAuthToken(session.access_token);
      });
      const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
        if (!session) router.push("/admin");
        else setAuthToken(session.access_token);
      });
      return () => subscription.unsubscribe();
    } else {
      const key = localStorage.getItem(`admin_api_key:${store_id}`);
      if (!key) {
        router.push("/admin");
        return;
      }
      setApiKey(key);
    }
  }, [store_id, router]);

  const headers = useMemo<Record<string, string> | null>(() => {
    if (isSupabaseEnabled) {
      if (!authToken) return null;
      return { Authorization: `Bearer ${authToken}`, "X-Store-ID": store_id } as Record<string, string>;
    }
    if (!apiKey) return null;
    return { "X-Api-Key": apiKey, "X-Store-ID": store_id } as Record<string, string>;
  }, [authToken, apiKey, store_id]);

  const loadProducts = useCallback(async () => {
    if (!headers) return;
    setRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/admin/products`, { headers });
      if (res.status === 401) {
        if (isSupabaseEnabled) {
          await supabase!.auth.signOut();
          router.push("/admin");
        } else {
          localStorage.removeItem(`admin_api_key:${store_id}`);
          router.push("/admin");
        }
        return;
      }
      if (!res.ok) throw new Error("商品一覧の取得に失敗しました");
      const data: Product[] = await res.json();
      setProducts(
        data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setRefreshing(false);
    }
  }, [headers, store_id, router]);

  useEffect(() => {
    if (headers) loadProducts();
  }, [headers, loadProducts]);

  useEffect(() => {
    if (!products) return;
    const pending = products.some((p) => !p.enriched_at);
    if (!pending) return;
    const interval = setInterval(() => loadProducts(), 3000);
    return () => clearInterval(interval);
  }, [products, loadProducts]);

  async function toggleAvailability(product: Product) {
    if (!headers) return;
    const next = !product.is_available;
    setProducts((prev) =>
      prev ? prev.map((p) => (p.id === product.id ? { ...p, is_available: next } : p)) : prev
    );
    try {
      await fetch(`${API_URL}/admin/products/${product.id}/availability`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ is_available: next }),
      });
    } catch {
      setProducts((prev) =>
        prev ? prev.map((p) => (p.id === product.id ? { ...p, is_available: !next } : p)) : prev
      );
    }
  }

  async function createProduct(input: { name: string; price: number; photo_url?: string }) {
    if (!headers) return;
    const res = await fetch(`${API_URL}/admin/products`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("商品の登録に失敗しました");
    setShowAddForm(false);
    loadProducts();
  }

  async function signOut() {
    if (isSupabaseEnabled) {
      await supabase!.auth.signOut();
    } else {
      localStorage.removeItem(`admin_api_key:${store_id}`);
    }
    router.push("/admin");
  }

  const isReady = isSupabaseEnabled ? !!authToken : !!apiKey;
  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-800 rounded-full animate-spin" />
      </div>
    );
  }

  const enrichedCount = products?.filter((p) => p.enriched_at).length ?? 0;
  const totalCount = products?.length ?? 0;

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-white/80 border-b border-neutral-200/70">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-neutral-400">Admin</p>
            <h1 className="text-base font-bold text-neutral-900">商品管理</h1>
            <a href={`/admin/${org_id}`} className="text-[11px] text-neutral-500 hover:text-neutral-900">
              ← Org に戻る
            </a>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/merchant/${store_id}/intake`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-white bg-neutral-900 px-3 py-1.5 rounded-lg hover:bg-black"
            >
              注文受信画面
            </a>
            <a
              href={`/admin/${org_id}/${store_id}/customer`}
              className="text-xs font-medium text-neutral-600 px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-100"
            >
              顧客管理
            </a>
            <button
              onClick={signOut}
              className="text-xs font-medium text-neutral-500 px-3 py-1.5 rounded-lg hover:bg-neutral-100"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-neutral-500">
            {totalCount} 品 ({enrichedCount} 件 enrich 完了)
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="text-sm font-semibold text-white bg-neutral-900 px-4 py-2 rounded-lg active:scale-95 transition-transform"
          >
            + 商品を追加
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {error}
          </div>
        )}

        {!products ? (
          <SkeletonList />
        ) : products.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-neutral-400 mb-4">まだ商品がありません</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="text-sm font-semibold text-white bg-neutral-900 px-5 py-2.5 rounded-lg"
            >
              最初の商品を追加
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {products.map((p) => (
              <ProductRow key={p.id} product={p} onToggle={() => toggleAvailability(p)} />
            ))}
          </div>
        )}

        {refreshing && (
          <p className="mt-4 text-center text-xs text-neutral-400">更新中...</p>
        )}
      </main>

      {showAddForm && headers && (
        <AddProductModal
          headers={headers}
          onClose={() => setShowAddForm(false)}
          onSubmit={createProduct}
        />
      )}

      {headers && (
        <AiCatalogChat headers={headers} onCreated={() => loadProducts()} />
      )}
    </div>
  );
}

function ProductRow({ product, onToggle }: { product: Product; onToggle: () => void }) {
  const enriching = !product.enriched_at;
  return (
    <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
      <div className="flex">
        <div className="w-24 h-24 flex-shrink-0 bg-neutral-100">
          {product.photo_url ? (
            <img src={product.photo_url} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-neutral-100 to-neutral-200" />
          )}
        </div>
        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-neutral-900 truncate">{product.name}</h3>
              <p className="text-sm text-neutral-600">¥{product.price.toLocaleString()}</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={product.is_available} onChange={onToggle} className="sr-only peer" />
              <div className="w-9 h-5 bg-neutral-200 rounded-full peer peer-checked:bg-neutral-900 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
            </label>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            {enriching ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                AI 解析中
              </span>
            ) : (
              <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">解析完了</span>
            )}
            {product.category && (
              <span className="text-[11px] text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">{product.category}</span>
            )}
          </div>
          {product.description && (
            <p className="mt-2 text-[12px] text-neutral-500 leading-relaxed line-clamp-2">{product.description}</p>
          )}
          {product.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {product.tags.slice(0, 5).map((t) => (
                <span key={t} className="text-[10px] text-neutral-600 bg-neutral-50 border border-neutral-100 px-1.5 py-0.5 rounded">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddProductModal({
  headers,
  onClose,
  onSubmit,
}: {
  headers: Record<string, string>;
  onClose: () => void;
  onSubmit: (input: { name: string; price: number; photo_url?: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPhotoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setPhotoPreview(url);
    } else {
      setPhotoPreview(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const priceNum = parseInt(price, 10);
    if (!name.trim() || !priceNum || priceNum <= 0) {
      setErr("商品名と価格を入力してください");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      let photoUrl: string | undefined;
      if (photoFile) {
        setUploading(true);
        const form = new FormData();
        form.append("file", photoFile);
        const res = await fetch(`${API_URL}/admin/upload`, { method: "POST", headers, body: form });
        setUploading(false);
        if (!res.ok) throw new Error("写真のアップロードに失敗しました");
        const { url } = await res.json();
        photoUrl = url;
      }
      await onSubmit({ name: name.trim(), price: priceNum, photo_url: photoUrl });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "エラー");
      setSubmitting(false);
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-neutral-900 mb-1">商品を追加</h2>
        <p className="text-xs text-neutral-500 mb-5">商品名と価格だけでOK。AIが残りを補完します。</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              商品名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 抹茶ラテ"
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-900"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              価格 (円) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="800"
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">写真（任意）</label>
            <div
              className="w-full rounded-xl border-2 border-dashed border-neutral-200 p-4 flex flex-col items-center justify-center cursor-pointer hover:border-neutral-400 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {photoPreview ? (
                <img src={photoPreview} alt="preview" className="h-24 w-auto rounded-lg object-cover" />
              ) : (
                <p className="text-sm text-neutral-400">クリックして写真を選択</p>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-neutral-200 text-sm font-medium text-neutral-700">
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting || uploading}
              className="flex-1 py-3 rounded-xl bg-neutral-900 text-white text-sm font-semibold disabled:opacity-40"
            >
              {uploading ? "アップロード中..." : submitting ? "登録中..." : "登録する"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-neutral-100 shadow-sm h-24 animate-pulse" />
      ))}
    </div>
  );
}
