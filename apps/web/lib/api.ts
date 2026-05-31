/**
 * Typed API client for the customer-facing flow.
 *
 * All requests use credentials: 'include' so the so_sid session cookie
 * travels both ways. The base URL comes from NEXT_PUBLIC_API_URL.
 */

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types — mirror apps/api/schemas.py contracts
// ---------------------------------------------------------------------------

export type EntryKind = "dine_in" | "takeout" | "counter" | "delivery";
export type EntryMode = "no" | "send" | "tab";

export interface EntryStoreContext {
  id: string;
  name: string;
  timezone: string;
}

export interface EntryContext {
  id: string;
  label: string;
  kind: EntryKind;
  mode: EntryMode;
  is_active: boolean;
  store: EntryStoreContext;
}

export interface SessionEntry {
  id: string;
  label: string;
  kind: EntryKind;
  mode: EntryMode;
}

export interface SessionResponse {
  session_id: string;
  store_id: string;
  entry: SessionEntry;
  created_at: string;
}

export interface Product {
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

export interface SuggestedProduct {
  id: string;
  name: string;
  price: number;
  photo_url: string | null;
  description: string | null;
  reason: string;
}

export interface InquiryOptions {
  tags: string[];
  situations: string[];
}

export interface SuggestResponse {
  session_id: string;
  suggestions: SuggestedProduct[];
  inquiry_options: InquiryOptions;
}

export interface TabItem {
  id: string;
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  note: string | null;
  cart_source: Record<string, unknown>;
  created_at: string;
}

export interface TabTotals {
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
}

export interface Tab {
  id: string;
  session_id: string;
  entry_id: string;
  store_id: string;
  state: "open" | "closed";
  items: TabItem[];
  totals: TabTotals;
  closed_at: string | null;
  created_at: string;
}

export interface TabCloseResponse {
  order_id: string;
  tab_id: string;
  status: string;
  dispatched_at: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data && typeof data.detail === "string") detail = data.detail;
    } catch {
      // ignore parse failure
    }
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

export function getEntry(entryId: string): Promise<EntryContext> {
  return request<EntryContext>(`/entries/${entryId}`);
}

export function startSession(entryId: string): Promise<SessionResponse> {
  return request<SessionResponse>(`/sessions`, {
    method: "POST",
    body: { entry_id: entryId, context: {} },
  });
}

export function getCatalog(storeId: string): Promise<Product[]> {
  return request<Product[]>(`/catalog/${storeId}/products`);
}

export function getSuggestions(
  sessionId: string,
  selections: { tags?: string[]; situation?: string | null } = {},
): Promise<SuggestResponse> {
  return request<SuggestResponse>(`/sessions/${sessionId}/suggest`, {
    method: "POST",
    body: { selections },
  });
}

export function getTab(sessionId: string): Promise<Tab> {
  return request<Tab>(`/sessions/${sessionId}/tab`);
}

export function addTabItem(
  sessionId: string,
  productId: string,
  quantity = 1,
  note?: string,
  cartSource: Record<string, unknown> = {},
): Promise<Tab> {
  return request<Tab>(`/sessions/${sessionId}/tab/items`, {
    method: "POST",
    body: {
      product_id: productId,
      quantity,
      note: note ?? null,
      cart_source: cartSource,
    },
  });
}

export function updateTabItem(
  sessionId: string,
  itemId: string,
  patch: { quantity?: number; note?: string | null },
): Promise<Tab> {
  return request<Tab>(`/sessions/${sessionId}/tab/items/${itemId}`, {
    method: "PATCH",
    body: patch,
  });
}

export function removeTabItem(
  sessionId: string,
  itemId: string,
): Promise<Tab | undefined> {
  return request<Tab | undefined>(`/sessions/${sessionId}/tab/items/${itemId}`, {
    method: "DELETE",
  });
}

export function closeTab(sessionId: string): Promise<TabCloseResponse> {
  return request<TabCloseResponse>(`/sessions/${sessionId}/tab/close`, {
    method: "POST",
  });
}
