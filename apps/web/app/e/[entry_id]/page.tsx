"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  addTabItem,
  closeTab,
  getCatalog,
  getEntry,
  getSuggestions,
  getTab,
  removeTabItem,
  startSession,
  type EntryContext,
  type InquiryOptions,
  type Product,
  type SessionEntry,
  type SuggestedProduct,
  type Tab,
} from "@/lib/api";

import InquiryTags from "./InquiryTags";
import MenuList from "./MenuList";
import SendButton from "./SendButton";
import SuggestionCards from "./SuggestionCards";
import TabView from "./TabView";

interface PageState {
  entry: EntryContext | null;
  session: { id: string; entry: SessionEntry } | null;
  catalog: Product[] | null;
  tab: Tab | null;
  inquiryOptions: InquiryOptions | null;
  suggestions: SuggestedProduct[] | null;
}

export default function EntryPage({
  params,
}: {
  params: Promise<{ entry_id: string }>;
}) {
  const { entry_id: entryId } = use(params);

  const [state, setState] = useState<PageState>({
    entry: null,
    session: null,
    catalog: null,
    tab: null,
    inquiryOptions: null,
    suggestions: null,
  });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [closing, setClosing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [orderSent, setOrderSent] = useState(false);

  // ---------------------------------------------------------------------
  // Init: entry → session → catalog + tab in parallel
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoadingInit(true);
      setErrorMessage(null);
      try {
        const entry = await getEntry(entryId);
        if (cancelled) return;
        const session = await startSession(entryId);
        if (cancelled) return;
        const [catalog, tab] = await Promise.all([
          getCatalog(session.store_id),
          getTab(session.session_id),
        ]);
        if (cancelled) return;
        setState({
          entry,
          session: { id: session.session_id, entry: session.entry },
          catalog,
          tab,
          inquiryOptions: null,
          suggestions: null,
        });
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "読み込みに失敗しました",
        );
      } finally {
        if (!cancelled) setLoadingInit(false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const sessionId = state.session?.id ?? null;
  const mode = state.entry?.mode ?? "send";

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  const fetchSuggestions = useCallback(async () => {
    if (!sessionId) return;
    setLoadingSuggest(true);
    try {
      const res = await getSuggestions(sessionId, { tags: selectedTags });
      setState((s) => ({
        ...s,
        suggestions: res.suggestions,
        inquiryOptions: res.inquiry_options,
      }));
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "提案の取得に失敗しました",
      );
    } finally {
      setLoadingSuggest(false);
    }
  }, [sessionId, selectedTags]);

  // Pre-fetch inquiry tag options once a session exists (no suggestions yet).
  useEffect(() => {
    if (!sessionId || state.inquiryOptions) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getSuggestions(sessionId, { tags: [] });
        if (cancelled) return;
        setState((s) => ({
          ...s,
          inquiryOptions: res.inquiry_options,
          // Don't overwrite suggestions on pre-fetch; only seed if empty.
          suggestions: s.suggestions ?? null,
        }));
      } catch {
        // Inquiry pre-fetch is best-effort; ignore errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, state.inquiryOptions]);

  const handleAdd = useCallback(
    async (
      productId: string,
      cartSource: Record<string, unknown> = {},
    ) => {
      if (!sessionId) return;
      try {
        const tab = await addTabItem(sessionId, productId, 1, undefined, cartSource);
        setState((s) => ({ ...s, tab }));
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "カートに追加できませんでした",
        );
      }
    },
    [sessionId],
  );

  const handleRemove = useCallback(
    async (itemId: string) => {
      if (!sessionId) return;
      try {
        await removeTabItem(sessionId, itemId);
        // DELETE may return 204 or the updated tab. Refetch to be safe.
        const tab = await getTab(sessionId);
        setState((s) => ({ ...s, tab }));
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "削除に失敗しました",
        );
      }
    },
    [sessionId],
  );

  const handleSend = useCallback(async () => {
    if (!sessionId) return;
    setClosing(true);
    try {
      await closeTab(sessionId);
      // Refresh tab (new open tab is created on next GET).
      const fresh = await getTab(sessionId);
      setState((s) => ({ ...s, tab: fresh, suggestions: null }));
      setOrderSent(true);
      window.setTimeout(() => setOrderSent(false), 3000);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "送信に失敗しました",
      );
    } finally {
      setClosing(false);
    }
  }, [sessionId]);

  // ---------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------
  const headerTitle = useMemo(() => {
    if (!state.entry) return "";
    return `${state.entry.label} — ${state.entry.store.name}`;
  }, [state.entry]);

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  if (loadingInit) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <div className="max-w-md mx-auto px-4 pt-10 space-y-4">
          <div className="h-6 w-40 bg-neutral-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-neutral-200 rounded animate-pulse" />
          <div className="grid grid-cols-2 gap-3 pt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[4/5] bg-neutral-200 rounded-2xl animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (errorMessage && !state.entry) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-6 text-center">
        <div>
          <p className="text-sm text-neutral-500">{errorMessage}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-full bg-neutral-900 text-white text-sm font-medium"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  const tabItemCount =
    state.tab?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
  const tabTotal = state.tab?.totals.total ?? 0;

  return (
    <>
      {/* Header */}
      <header className="fixed top-0 inset-x-0 z-30">
        <div className="max-w-md mx-auto">
          <div className="backdrop-blur-xl bg-white/80 border-b border-white/40 supports-[backdrop-filter]:bg-white/70">
            <div className="px-4 pt-4 pb-3">
              <p className="text-[10px] uppercase tracking-widest text-neutral-400">
                {state.entry?.kind === "takeout"
                  ? "Takeout"
                  : state.entry?.kind === "counter"
                    ? "Counter"
                    : "Dine in"}
              </p>
              <h1 className="text-base font-bold text-neutral-900 truncate">
                {headerTitle}
              </h1>
              {mode === "no" && (
                <p className="mt-1 text-[11px] text-neutral-500">
                  メニュー閲覧のみ
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main: inquiry → suggestions → menu */}
      <main
        className="min-h-screen bg-neutral-50 pt-[88px]"
        style={{ paddingBottom: tabItemCount > 0 ? 200 : 96 }}
      >
        <div className="max-w-md mx-auto px-4 py-4 space-y-5">
          <InquiryTags
            options={state.inquiryOptions}
            selectedTags={selectedTags}
            onToggleTag={toggleTag}
            onSubmit={fetchSuggestions}
            loading={loadingSuggest}
          />

          {state.suggestions && state.suggestions.length > 0 && (
            <SuggestionCards
              suggestions={state.suggestions}
              onAdd={(s) =>
                handleAdd(s.id, {
                  ai_assisted: true,
                  inquiry_tags: selectedTags,
                  reason: s.reason,
                })
              }
            />
          )}

          <MenuList
            products={state.catalog ?? []}
            onAdd={(p) => handleAdd(p.id, { ai_assisted: false })}
          />
        </div>
      </main>

      {/* Bottom: tab + send */}
      <div className="fixed bottom-0 inset-x-0 z-30 pb-5 pt-3 pointer-events-none">
        <div className="max-w-md mx-auto px-4 pointer-events-auto space-y-2">
          <TabView
            tab={state.tab}
            onRemove={handleRemove}
          />
          {mode === "send" && (
            <SendButton
              disabled={tabItemCount === 0 || closing}
              loading={closing}
              total={tabTotal}
              onClick={handleSend}
            />
          )}
        </div>
      </div>

      {errorMessage && state.entry && (
        <div className="fixed top-[88px] inset-x-0 z-40 px-4">
          <div className="max-w-md mx-auto bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2 flex items-center justify-between">
            <span className="truncate">{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="ml-2 text-red-500 font-bold"
              aria-label="閉じる"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {orderSent && (
        <button
          onClick={() => setOrderSent(false)}
          className="fixed inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center px-6 text-center"
          aria-label="閉じる"
        >
          <div className="w-16 h-16 rounded-full bg-neutral-900 text-white flex items-center justify-center text-3xl mb-4">
            ✓
          </div>
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">
            ご注文を送信しました
          </h2>
          <p className="text-sm text-neutral-500">
            タップして閉じる
          </p>
        </button>
      )}
    </>
  );
}
