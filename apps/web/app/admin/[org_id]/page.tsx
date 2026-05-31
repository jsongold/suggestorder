"use client";

import { useCallback, useEffect, useState, use } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Store {
  id: string;
  org_id: string;
  name: string;
  api_key: string;
  timezone: string;
  destination_type: string;
  payment_channel: string;
  created_at: string;
}

interface Org {
  id: string;
  name: string;
  created_at: string;
}

export default function AdminOrgPage({
  params,
}: {
  params: Promise<{ org_id: string }>;
}) {
  const { org_id } = use(params);

  const [org, setOrg] = useState<Org | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [justCreated, setJustCreated] = useState<Store | null>(null);

  const loadStores = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_URL}/admin/stores?org_id=${encodeURIComponent(org_id)}`
      );
      if (!res.ok) throw new Error("店舗一覧の取得に失敗しました");
      const data: Store[] = await res.json();
      setStores(
        data.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    }
  }, [org_id]);

  const loadOrg = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/admin/orgs`);
      if (!res.ok) return;
      const data: Org[] = await res.json();
      const found = data.find((o) => o.id === org_id);
      if (found) setOrg(found);
    } catch {
      // non-fatal
    }
  }, [org_id]);

  useEffect(() => {
    loadOrg();
    loadStores();
  }, [loadOrg, loadStores]);

  async function createStore(name: string) {
    const res = await fetch(`${API_URL}/admin/stores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_id, name }),
    });
    if (!res.ok) throw new Error("店舗の作成に失敗しました");
    const store: Store = await res.json();
    localStorage.setItem(`admin_api_key:${store.id}`, store.api_key);
    setJustCreated(store);
    setShowAddForm(false);
    loadStores();
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-white/80 border-b border-neutral-200/70">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-neutral-400">
              Org
            </p>
            <h1 className="text-base font-bold text-neutral-900 truncate">
              {org?.name ?? "..."}
            </h1>
          </div>
          <a
            href="/admin"
            className="text-xs font-medium text-neutral-500 px-3 py-1.5 rounded-lg hover:bg-neutral-100"
          >
            ログアウト
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-neutral-500">
            {stores ? `${stores.length} 店舗` : "..."}
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="text-sm font-semibold text-white bg-neutral-900 px-4 py-2 rounded-lg active:scale-95 transition-transform"
          >
            + 店舗を追加
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {error}
          </div>
        )}

        {!stores ? (
          <SkeletonList />
        ) : stores.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-neutral-400 mb-4">まだ店舗がありません</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="text-sm font-semibold text-white bg-neutral-900 px-5 py-2.5 rounded-lg"
            >
              最初の店舗を追加
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {stores.map((s) => (
              <a
                key={s.id}
                href={`/admin/${org_id}/${s.id}`}
                className="block bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 hover:border-neutral-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-neutral-900 truncate">
                      {s.name}
                    </h3>
                    <p className="mt-1 text-[11px] text-neutral-400 font-mono truncate">
                      {s.id}
                    </p>
                  </div>
                  <span className="text-neutral-300">›</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>

      {showAddForm && (
        <AddStoreModal
          onClose={() => setShowAddForm(false)}
          onSubmit={createStore}
        />
      )}

      {justCreated && (
        <CredentialsModal
          store={justCreated}
          onClose={() => setJustCreated(null)}
        />
      )}
    </div>
  );
}

function AddStoreModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      await onSubmit(name.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "エラー");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-neutral-900 mb-1">店舗を追加</h2>
        <p className="text-xs text-neutral-500 mb-5">
          この Org の配下に新しい店舗を作成します。
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              店舗名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: Cafe Komorebi 渋谷店"
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-900"
              autoFocus
            />
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-neutral-200 text-sm font-medium text-neutral-700"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="flex-1 py-3 rounded-xl bg-neutral-900 text-white text-sm font-semibold disabled:opacity-40"
            >
              {submitting ? "作成中..." : "作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CredentialsModal({
  store,
  onClose,
}: {
  store: Store;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-neutral-900 mb-1">
          {store.name} を作成しました
        </h2>
        <p className="text-xs text-neutral-500 mb-5">
          API Key は再表示できません。今すぐ控えてください。
        </p>
        <div className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-neutral-400 mb-1">
              Store ID
            </p>
            <p className="font-mono text-xs text-neutral-800 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2 break-all">
              {store.id}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-neutral-400 mb-1">
              API Key
            </p>
            <p className="font-mono text-xs text-neutral-800 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2 break-all">
              {store.api_key}
            </p>
          </div>
        </div>
        <div className="mt-6 flex gap-2">
          <a
            href={`/admin/${store.org_id}/${store.id}`}
            className="flex-1 py-3 rounded-xl bg-neutral-900 text-white text-sm font-semibold text-center"
          >
            この店舗を管理
          </a>
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-neutral-200 text-sm font-medium text-neutral-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-2xl border border-neutral-100 shadow-sm h-20 animate-pulse"
        />
      ))}
    </div>
  );
}
