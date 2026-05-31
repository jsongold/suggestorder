"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Supabase Auth flow
// ---------------------------------------------------------------------------

type SetupState = { orgName: string; storeName: string };

function SupabaseAdminEntry() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null); // null = not in setup mode

  useEffect(() => {
    // Resume session if already logged in
    supabase!.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      await redirectOrSetup(session.access_token);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function redirectOrSetup(accessToken: string) {
    const res = await fetch(`${API_URL}/admin/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.setup_required) {
      setSetup({ orgName: "", storeName: "" });
    } else {
      router.push(`/admin/${data.org.id}`);
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: authError } =
        mode === "signup"
          ? await supabase!.auth.signUp({ email: email.trim(), password })
          : await supabase!.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
      if (!data.session) {
        // signUp may require email confirmation
        setError("確認メールを送信しました。メールを確認してからログインしてください。");
        setMode("signin");
        return;
      }
      await redirectOrSetup(data.session.access_token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "認証に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (!setup || !setup.orgName.trim() || !setup.storeName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      if (!session) throw new Error("セッションが切れました");
      const res = await fetch(`${API_URL}/admin/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ org_name: setup.orgName.trim(), store_name: setup.storeName.trim() }),
      });
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({}));
        throw new Error(detail || "セットアップに失敗しました");
      }
      const result = await res.json();
      // persist API key for intake page
      try {
        localStorage.setItem(`admin_api_key:${result.store.id}`, result.store.api_key);
      } catch {}
      router.push(`/admin/${result.org.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "エラー");
    } finally {
      setLoading(false);
    }
  }

  if (setup !== null) {
    return (
      <AuthShell title="初期設定" subtitle="Org と最初の店舗を作成してください">
        <form onSubmit={handleSetup} className="space-y-4">
          <Field label="Org 名（運営団体）">
            <input
              type="text"
              value={setup.orgName}
              onChange={(e) => setSetup({ ...setup, orgName: e.target.value })}
              placeholder="例: Komorebi 株式会社"
              className={inputClass}
            />
          </Field>
          <Field label="最初の店舗名">
            <input
              type="text"
              value={setup.storeName}
              onChange={(e) => setSetup({ ...setup, storeName: e.target.value })}
              placeholder="例: Cafe Komorebi 中目黒店"
              className={inputClass}
            />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <SubmitButton loading={loading} disabled={!setup.orgName.trim() || !setup.storeName.trim()}>
            作成して開始
          </SubmitButton>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="店舗管理" subtitle="suggestorder admin">
      <div className="flex gap-2 mb-6">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === m ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {m === "signin" ? "ログイン" : "新規登録"}
          </button>
        ))}
      </div>
      <form onSubmit={handleAuth} className="space-y-4">
        <Field label="メールアドレス">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
            autoComplete="email"
          />
        </Field>
        <Field label="パスワード">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <SubmitButton loading={loading} disabled={!email.trim() || !password.trim()}>
          {mode === "signin" ? "ログイン" : "登録"}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// Legacy API-key flow (local dev)
// ---------------------------------------------------------------------------

function ApiKeyAdminEntry() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [orgName, setOrgName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createOrgAndStore(e: React.FormEvent) {
    e.preventDefault();
    if (!orgName.trim() || !storeName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const orgRes = await fetch(`${API_URL}/admin/orgs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName.trim() }),
      });
      if (!orgRes.ok) throw new Error("Org の作成に失敗しました");
      const org = await orgRes.json();
      const storeRes = await fetch(`${API_URL}/admin/stores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: org.id, name: storeName.trim() }),
      });
      if (!storeRes.ok) throw new Error("店舗の作成に失敗しました");
      const store = await storeRes.json();
      localStorage.setItem(`admin_api_key:${store.id}`, store.api_key);
      router.push(`/admin/${org.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラー");
    } finally {
      setLoading(false);
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId.trim() || !apiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/stores/${storeId.trim()}`);
      if (!res.ok) throw new Error("Store ID が見つかりません");
      const store = await res.json();
      localStorage.setItem(`admin_api_key:${storeId.trim()}`, apiKey.trim());
      router.push(`/admin/${store.org_id}/${storeId.trim()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラー");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="店舗管理" subtitle="suggestorder admin">
      <div className="flex gap-2 mb-6">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === m ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {m === "signin" ? "既存店舗" : "新規作成"}
          </button>
        ))}
      </div>
      {mode === "signup" ? (
        <form onSubmit={createOrgAndStore} className="space-y-4">
          <Field label="Org 名（運営団体）">
            <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="例: Komorebi 株式会社" className={inputClass} />
          </Field>
          <Field label="最初の店舗名">
            <input type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="例: Cafe Komorebi 中目黒店" className={inputClass} />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <SubmitButton loading={loading} disabled={!orgName.trim() || !storeName.trim()}>Org と店舗を作成</SubmitButton>
        </form>
      ) : (
        <form onSubmit={signIn} className="space-y-4">
          <Field label="Store ID">
            <input type="text" value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="uuid" className={`${inputClass} font-mono`} />
          </Field>
          <Field label="API Key">
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={`${inputClass} font-mono`} />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <SubmitButton loading={loading} disabled={!storeId.trim() || !apiKey.trim()}>ログイン</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

const inputClass =
  "w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-900";

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-neutral-900">{title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-100 p-6">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-neutral-400">
          顧客向けメニュー: <span className="font-mono">/{`{store_id}`}</span>
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function SubmitButton({
  loading,
  disabled,
  children,
}: {
  loading: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="w-full py-3 rounded-xl bg-neutral-900 text-white font-semibold text-sm disabled:opacity-40"
    >
      {loading ? "処理中..." : children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default function AdminEntryPage() {
  return isSupabaseEnabled ? <SupabaseAdminEntry /> : <ApiKeyAdminEntry />;
}
