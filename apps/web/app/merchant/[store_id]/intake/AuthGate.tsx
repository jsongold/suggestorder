"use client";

import { useState } from "react";

interface AuthGateProps {
  storeId: string;
  onAuth: (apiKey: string) => void;
}

/**
 * Minimal API-key prompt shown until the user supplies (or has previously
 * supplied) credentials for this store. The api_key is stored under the same
 * localStorage key the /admin page uses, so signing in once authorizes both.
 */
export default function AuthGate({ storeId, onAuth }: AuthGateProps) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError("API キーを入力してください");
      return;
    }
    try {
      localStorage.setItem(`admin_api_key:${storeId}`, trimmed);
    } catch {
      // ignore; we still let the in-memory key proceed
    }
    onAuth(trimmed);
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <p className="text-[10px] uppercase tracking-widest text-neutral-400">
            Merchant
          </p>
          <h1 className="text-2xl font-bold text-neutral-900 mt-1">注文受信</h1>
          <p className="mt-2 text-sm text-neutral-500">
            店舗の API キーを入力してください
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-neutral-100 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1.5">
                Store ID
              </label>
              <input
                type="text"
                value={storeId}
                readOnly
                className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm font-mono bg-neutral-50 text-neutral-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1.5">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="api_key"
                autoFocus
                className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm font-mono focus:outline-none focus:border-neutral-900"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-neutral-900 text-white font-semibold text-sm active:scale-[0.98] transition-transform"
            >
              受信を開始
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-neutral-400">
          管理画面ですでにログイン済みの場合、キーは自動で読み込まれます
        </p>
      </div>
    </div>
  );
}
