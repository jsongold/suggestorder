"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "./AuthGate";
import OrderCard from "./OrderCard";
import {
  AuthHeaders,
  IntakeOrder,
  OrderStatus,
  useOrderPolling,
} from "./useOrderPolling";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function MerchantIntakePage({
  params,
}: {
  params: Promise<{ store_id: string }>;
}) {
  const { store_id } = use(params);

  // Auth bootstrap from localStorage. Empty string means "checked, none found".
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`admin_api_key:${store_id}`);
      setApiKey(stored ?? "");
    } catch {
      setApiKey("");
    }
  }, [store_id]);

  const headers = useMemo<AuthHeaders | null>(() => {
    if (!apiKey) return null;
    return { "X-Api-Key": apiKey, "X-Store-ID": store_id };
  }, [apiKey, store_id]);

  if (apiKey === null) {
    // Still reading localStorage — render nothing rather than flashing AuthGate.
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!apiKey || !headers) {
    return <AuthGate storeId={store_id} onAuth={(k) => setApiKey(k)} />;
  }

  return (
    <IntakeBoard
      storeId={store_id}
      headers={headers}
      onSignOut={() => {
        try {
          localStorage.removeItem(`admin_api_key:${store_id}`);
        } catch {
          /* ignore */
        }
        setApiKey("");
      }}
    />
  );
}

function IntakeBoard({
  storeId,
  headers,
  onSignOut,
}: {
  storeId: string;
  headers: AuthHeaders;
  onSignOut: () => void;
}) {
  const {
    orders,
    loading,
    error,
    lastSyncedAt,
    refresh,
    upsertOrder,
    removeOrder,
    newOrderTick,
  } = useOrderPolling(storeId, headers);

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [muteChime, setMuteChime] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/admin/stores/${storeId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.org_id) setOrgId(data.org_id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  // Audio chime on new order. We lazily create an AudioContext on the first
  // user interaction so the browser's autoplay policy doesn't block us.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);

  useEffect(() => {
    function unlock() {
      audioUnlockedRef.current = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (newOrderTick === 0) return;
    if (muteChime) return;
    if (!audioUnlockedRef.current) return;
    playChime(audioCtxRef);
  }, [newOrderTick, muteChime]);

  const setPending = useCallback((id: string, pending: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const updateStatus = useCallback(
    async (order: IntakeOrder, next: OrderStatus, reason?: string) => {
      setPending(order.id, true);
      setMutationError(null);
      try {
        const res = await fetch(
          `${API_URL}/intake/${storeId}/orders/${order.id}/status`,
          {
            method: "PATCH",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ state: next, ...(reason ? { reason } : {}) }),
          }
        );
        if (!res.ok) {
          throw new Error(`ステータス更新に失敗 (${res.status})`);
        }
        // Prefer the server's authoritative response; fall back to optimistic.
        const updated: IntakeOrder | null = await safeJson<IntakeOrder>(res);
        if (updated && updated.id) {
          if (next === "handed" || next === "canceled") {
            removeOrder(order.id);
          } else {
            upsertOrder(updated);
          }
        } else {
          if (next === "handed" || next === "canceled") {
            removeOrder(order.id);
          } else {
            upsertOrder({
              ...order,
              status: next,
              updated_at: new Date().toISOString(),
            });
          }
        }
      } catch (e) {
        setMutationError(e instanceof Error ? e.message : "通信エラー");
      } finally {
        setPending(order.id, false);
      }
    },
    [headers, storeId, setPending, upsertOrder, removeOrder]
  );

  const handleAdvance = useCallback(
    (order: IntakeOrder, next: OrderStatus) => {
      updateStatus(order, next);
    },
    [updateStatus]
  );

  const handleCancel = useCallback(
    (order: IntakeOrder) => {
      const reason = window.prompt(
        `「${order.payload?.entry?.label ?? "注文"}」をキャンセルする理由を入力してください`
      );
      if (!reason || !reason.trim()) return;
      updateStatus(order, "canceled", reason.trim());
    },
    [updateStatus]
  );

  const togglePayment = useCallback(
    async (order: IntakeOrder) => {
      const nextStatus = order.payment_status === "paid" ? "unpaid" : "paid";
      setPending(order.id, true);
      setMutationError(null);
      try {
        const body: Record<string, unknown> = { status: nextStatus };
        if (nextStatus === "paid") body.method = "cash";
        const res = await fetch(
          `${API_URL}/intake/${storeId}/orders/${order.id}/payment`,
          {
            method: "PATCH",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          throw new Error(`支払い状態の更新に失敗 (${res.status})`);
        }
        const updated: IntakeOrder | null = await safeJson<IntakeOrder>(res);
        if (updated && updated.id) {
          upsertOrder(updated);
        } else {
          upsertOrder({
            ...order,
            payment_status: nextStatus,
            updated_at: new Date().toISOString(),
          });
        }
      } catch (e) {
        setMutationError(e instanceof Error ? e.message : "通信エラー");
      } finally {
        setPending(order.id, false);
      }
    },
    [headers, storeId, setPending, upsertOrder]
  );

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-white/85 border-b border-neutral-200">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-neutral-400">
              Merchant Intake
            </p>
            <h1 className="text-lg sm:text-xl font-bold text-neutral-900">
              注文 ({orders.length})
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SyncIndicator
              loading={loading}
              error={error}
              lastSyncedAt={lastSyncedAt}
            />
            <button
              onClick={() => setMuteChime((m) => !m)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${
                muteChime
                  ? "bg-neutral-100 text-neutral-500 border-neutral-200"
                  : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
              }`}
              title={muteChime ? "通知音オフ" : "通知音オン"}
            >
              {muteChime ? "音 オフ" : "音 オン"}
            </button>
            <button
              onClick={() => refresh()}
              className="text-xs font-semibold text-neutral-700 px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50"
            >
              再取得
            </button>
            {orgId && (
              <a
                href={`/admin/${orgId}/${storeId}`}
                className="text-xs font-semibold text-neutral-700 px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 hidden sm:inline-block"
              >
                管理画面
              </a>
            )}
            <button
              onClick={onSignOut}
              className="text-xs font-semibold text-neutral-500 px-3 py-1.5 rounded-lg hover:bg-neutral-100"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {mutationError && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
            {mutationError}
          </div>
        )}

        {loading && orders.length === 0 ? (
          <SkeletonGrid />
        ) : orders.length === 0 ? (
          <EmptyState error={error} />
        ) : (
          <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {orders.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                pending={pendingIds.has(o.id)}
                onAdvance={(next) => handleAdvance(o, next)}
                onCancel={() => handleCancel(o)}
                onTogglePayment={() => togglePayment(o)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function SyncIndicator({
  loading,
  error,
  lastSyncedAt,
}: {
  loading: boolean;
  error: string | null;
  lastSyncedAt: Date | null;
}) {
  if (error) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full"
        title={error}
      >
        <span className="w-2 h-2 rounded-full bg-red-500" />
        切断
      </span>
    );
  }
  return (
    <span
      className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 bg-neutral-50 border border-neutral-200 px-2.5 py-1 rounded-full"
      title={lastSyncedAt ? `最終同期 ${lastSyncedAt.toLocaleTimeString()}` : ""}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          loading ? "bg-amber-400 animate-pulse" : "bg-emerald-500"
        }`}
      />
      {loading ? "同期中" : "接続中"}
    </span>
  );
}

function EmptyState({ error }: { error: string | null }) {
  return (
    <div className="py-24 text-center">
      <div className="mx-auto w-16 h-16 rounded-full bg-white border border-neutral-200 flex items-center justify-center text-neutral-400 text-2xl">
        ☕
      </div>
      <p className="mt-4 text-base font-semibold text-neutral-700">
        現在の注文はありません
      </p>
      <p className="mt-1 text-sm text-neutral-400">
        新しい注文が届くと自動で表示されます
      </p>
      {error && (
        <p className="mt-4 text-xs text-red-600 max-w-md mx-auto">{error}</p>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="h-72 rounded-2xl bg-white border border-neutral-200 animate-pulse"
        />
      ))}
    </div>
  );
}

/* ---------- helpers ---------- */

async function safeJson<T>(res: Response): Promise<T | null> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Plays a short two-tone sine "ding" via Web Audio. No external assets.
 * The AudioContext is cached in a ref so we don't spin up a new one per call.
 */
function playChime(ctxRef: { current: AudioContext | null }) {
  try {
    // Safari still ships webkitAudioContext on older versions.
    const Ctor: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    if (!Ctor) return;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const now = ctx.currentTime;
    playTone(ctx, 880, now, 0.18);
    playTone(ctx, 1320, now + 0.16, 0.22);
  } catch {
    // Best-effort; chime failures must not break the UI.
  }
}

function playTone(ctx: AudioContext, freq: number, start: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // Quick attack, slow decay envelope to avoid clicks.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}
