"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const POLL_INTERVAL_MS = 5000;

/** Subset of StandaloneOrderPayload we render in the merchant UI. */
export interface OrderLineModifier {
  modifier_id: string;
  name: string;
  price_delta?: { amount: number; currency: string };
}

export interface OrderLineItem {
  line_id: string;
  item_id: string;
  name: string;
  quantity: number;
  unit_price: { amount: number; currency: string };
  subtotal: { amount: number; currency: string };
  modifiers?: OrderLineModifier[];
  note?: string;
}

export interface OrderTotals {
  subtotal: { amount: number; currency: string };
  tax: { amount: number; currency: string };
  total: { amount: number; currency: string };
  discount?: { amount: number; currency: string };
}

export interface OrderPaymentInfo {
  status: "unpaid" | "authorized" | "paid" | "refunded" | "void";
  method?: "cash" | "card" | "qr" | "in_app" | "other";
  paid_at?: string;
  external_ref?: string;
}

export type OrderStatus = "received" | "preparing" | "ready" | "handed" | "canceled";

export interface OrderStatusInfo {
  current: OrderStatus;
  updated_at: string;
  history?: Array<{
    state: OrderStatus;
    at: string;
    actor?: string;
    reason?: string;
  }>;
}

export interface OrderCartSource {
  ai_assisted?: boolean;
  inquiry_tags?: string[];
  inquiry_trail?: Array<{ step: number; question: string; answer: string }>;
}

export interface OrderEntry {
  id: string;
  kind: "dine_in" | "takeout" | "delivery" | "counter";
  label: string;
}

export interface OrderPayload {
  schema_version?: string;
  order_id?: string;
  store?: { id: string; name: string; timezone?: string };
  entry?: OrderEntry;
  session?: { id: string; started_at?: string };
  mode?: "send" | "tab" | "no";
  closed_at?: string;
  line_items?: OrderLineItem[];
  totals?: OrderTotals;
  cart_source?: OrderCartSource;
  payment?: OrderPaymentInfo;
  status?: OrderStatusInfo;
}

/**
 * The intake API returns orders with a top-level envelope plus the embedded
 * payload. We accept multiple plausible shapes and normalize them client-side.
 */
export interface IntakeOrder {
  id: string;
  store_id: string;
  status: OrderStatus;
  payment_status: OrderPaymentInfo["status"];
  created_at: string;
  updated_at: string;
  payload: OrderPayload;
}

export interface AuthHeaders {
  [key: string]: string;
  "X-Api-Key": string;
  "X-Store-ID": string;
}

interface UseOrderPollingResult {
  orders: IntakeOrder[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: Date | null;
  refresh: () => Promise<void>;
  /**
   * Replace a single order in local state (e.g. after PATCH so UI updates
   * without waiting for the next poll). Returns nothing.
   */
  upsertOrder: (order: IntakeOrder) => void;
  /** Remove an order from local state (e.g. status reached `handed`). */
  removeOrder: (orderId: string) => void;
  /** True when a brand-new (previously unseen) order arrived since last tick. */
  newOrderTick: number;
}

const ACTIVE_STATUSES: OrderStatus[] = ["received", "preparing", "ready"];

function isActive(status: OrderStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * Polls GET /intake/{store_id}/orders?status=active every 5 seconds.
 *
 * Uses `since` cursor (last `updated_at` among current orders) when available
 * to do an incremental fetch; on initial load (or after error) does a full
 * fetch. The hook is the single source of truth for the order list.
 */
export function useOrderPolling(
  storeId: string | null,
  headers: AuthHeaders | null
): UseOrderPollingResult {
  const [orders, setOrders] = useState<IntakeOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [newOrderTick, setNewOrderTick] = useState<number>(0);

  // Refs so the polling closure always sees the latest state without
  // re-creating the interval (which would reset its phase every render).
  const ordersRef = useRef<IntakeOrder[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const sinceRef = useRef<string | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const initializedRef = useRef<boolean>(false);

  // Keep ordersRef in sync.
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const fetchOrders = useCallback(
    async (full: boolean) => {
      if (!storeId || !headers) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const params = new URLSearchParams({ status: "active" });
        if (!full && sinceRef.current) {
          params.set("since", sinceRef.current);
        }
        const res = await fetch(
          `${API_URL}/intake/${storeId}/orders?${params.toString()}`,
          { headers, cache: "no-store" }
        );
        if (!res.ok) {
          throw new Error(`注文の取得に失敗しました (${res.status})`);
        }
        const raw = await res.json();
        const list: IntakeOrder[] = Array.isArray(raw)
          ? (raw as IntakeOrder[])
          : Array.isArray(raw?.orders)
          ? (raw.orders as IntakeOrder[])
          : [];

        // Merge with current state. If full=true, replace; otherwise upsert
        // each returned order and drop any that have become terminal.
        let merged: IntakeOrder[];
        if (full) {
          merged = list.filter((o) => isActive(o.status));
        } else {
          const byId = new Map<string, IntakeOrder>();
          for (const o of ordersRef.current) byId.set(o.id, o);
          for (const o of list) {
            if (isActive(o.status)) {
              byId.set(o.id, o);
            } else {
              byId.delete(o.id);
            }
          }
          merged = Array.from(byId.values());
        }

        // Newest first by created_at.
        merged.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        // Detect new orders (ids we haven't seen before) for chime trigger.
        let hasNew = false;
        if (initializedRef.current) {
          for (const o of merged) {
            if (!seenIdsRef.current.has(o.id)) {
              hasNew = true;
              break;
            }
          }
        }
        for (const o of merged) seenIdsRef.current.add(o.id);
        initializedRef.current = true;

        // Update `since` cursor to the max updated_at we've seen.
        let maxUpdated: string | null = sinceRef.current;
        for (const o of merged) {
          if (!maxUpdated || o.updated_at > maxUpdated) {
            maxUpdated = o.updated_at;
          }
        }
        sinceRef.current = maxUpdated;

        setOrders(merged);
        setError(null);
        setLastSyncedAt(new Date());
        if (hasNew) setNewOrderTick((t) => t + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : "通信エラー");
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [storeId, headers]
  );

  // Reset cursor and state when storeId / auth change.
  useEffect(() => {
    sinceRef.current = null;
    seenIdsRef.current = new Set();
    initializedRef.current = false;
    setOrders([]);
    setLoading(true);
  }, [storeId, headers]);

  // Initial fetch + interval. We do NOT add fetchOrders to the deps of the
  // setInterval-wrapping effect; fetchOrders' identity is stable for a given
  // (storeId, headers) pair.
  useEffect(() => {
    if (!storeId || !headers) return;
    // Initial full load.
    fetchOrders(true);
    const id = setInterval(() => {
      fetchOrders(false);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [storeId, headers, fetchOrders]);

  const refresh = useCallback(async () => {
    await fetchOrders(true);
  }, [fetchOrders]);

  const upsertOrder = useCallback((order: IntakeOrder) => {
    setOrders((prev) => {
      if (!isActive(order.status)) {
        return prev.filter((o) => o.id !== order.id);
      }
      const idx = prev.findIndex((o) => o.id === order.id);
      if (idx === -1) {
        return [order, ...prev];
      }
      const next = prev.slice();
      next[idx] = order;
      return next;
    });
  }, []);

  const removeOrder = useCallback((orderId: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
  }, []);

  return {
    orders,
    loading,
    error,
    lastSyncedAt,
    refresh,
    upsertOrder,
    removeOrder,
    newOrderTick,
  };
}
