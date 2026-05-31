"use client";

import { use, useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Entry {
  id: string;
  store_id: string;
  label: string;
  kind: string;
  mode: string;
  is_active: boolean;
  created_at: string;
}

type EntryKind = "dine_in" | "takeout" | "counter" | "delivery";
type EntryMode = "no" | "send" | "tab";

const KIND_LABEL: Record<EntryKind, string> = {
  dine_in: "店内",
  takeout: "テイクアウト",
  counter: "カウンター",
  delivery: "デリバリー",
};
const MODE_LABEL: Record<EntryMode, string> = {
  no: "注文なし",
  send: "注文送信",
  tab: "タブ精算",
};

export default function AdminCustomerPage({
  params,
}: {
  params: Promise<{ org_id: string; store_id: string }>;
}) {
  const { org_id, store_id } = use(params);

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [origin, setOrigin] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [qrDialog, setQrDialog] = useState<Entry | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  useEffect(() => {
    if (!printingId) return;
    const reset = () => setPrintingId(null);
    window.addEventListener("afterprint", reset);
    const raf = requestAnimationFrame(() => window.print());
    return () => {
      window.removeEventListener("afterprint", reset);
      cancelAnimationFrame(raf);
    };
  }, [printingId]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/admin/stores/${store_id}/entries`);
      if (!res.ok) throw new Error("Entry 一覧の取得に失敗しました");
      const data: Entry[] = await res.json();
      setEntries(
        data.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    }
  }, [store_id]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  async function createEntry(input: {
    label: string;
    kind: EntryKind;
    mode: EntryMode;
  }) {
    const res = await fetch(`${API_URL}/admin/stores/${store_id}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("Entry の作成に失敗しました");
    setShowAddForm(false);
    loadEntries();
  }

  async function toggleActive(entry: Entry) {
    const next = !entry.is_active;
    setEntries((prev) =>
      prev
        ? prev.map((e) =>
            e.id === entry.id ? { ...e, is_active: next } : e
          )
        : prev
    );
    try {
      const res = await fetch(`${API_URL}/admin/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setEntries((prev) =>
        prev
          ? prev.map((e) =>
              e.id === entry.id ? { ...e, is_active: !next } : e
            )
          : prev
      );
    }
  }

  async function deleteEntry(entry: Entry) {
    if (
      !window.confirm(
        `「${entry.label}」を削除します。注文履歴があると削除できません。`
      )
    )
      return;
    try {
      const res = await fetch(`${API_URL}/admin/entries/${entry.id}`, {
        method: "DELETE",
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        setError(
          data?.detail ??
            "この Entry は注文履歴があるため削除できません。停止してください。"
        );
        return;
      }
      if (!res.ok) throw new Error("削除に失敗しました");
      setError(null);
      loadEntries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    }
  }

  const entryUrl = (entryId: string) => `${origin}/e/${entryId}`;

  return (
    <div className="min-h-screen bg-neutral-50 print:bg-white">
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-white/80 border-b border-neutral-200/70 print:hidden">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-neutral-400">
              Admin / Store
            </p>
            <h1 className="text-base font-bold text-neutral-900">顧客管理</h1>
            <a
              href={`/admin/${org_id}/${store_id}`}
              className="text-[11px] text-neutral-500 hover:text-neutral-900"
            >
              ← 商品管理に戻る
            </a>
          </div>
          <button
            onClick={() => {
              setPrintingId(null);
              setTimeout(() => window.print(), 0);
            }}
            className="text-xs font-semibold text-white bg-neutral-900 px-4 py-2 rounded-lg hover:bg-black"
          >
            全 QR を印刷
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 print:py-2 space-y-10">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 print:hidden">
            {error}
          </div>
        )}

        <section className="print:hidden">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xs font-semibold tracking-widest text-neutral-400 uppercase">
                Entry（テーブル / 入口）
              </h2>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                顧客が QR から到達する受付ポイント
              </p>
            </div>
            <button
              onClick={() => setShowAddForm(true)}
              className="text-sm font-semibold text-white bg-neutral-900 px-4 py-2 rounded-lg active:scale-95 transition-transform"
            >
              + Entry を追加
            </button>
          </div>

          {!entries ? (
            <SkeletonRows />
          ) : entries.length === 0 ? (
            <div className="py-12 text-center bg-white rounded-2xl border border-neutral-100">
              <p className="text-sm text-neutral-400 mb-3">Entry がありません</p>
              <button
                onClick={() => setShowAddForm(true)}
                className="text-sm font-semibold text-white bg-neutral-900 px-5 py-2.5 rounded-lg"
              >
                最初の Entry を追加
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  onToggle={() => toggleActive(e)}
                  onDelete={() => deleteEntry(e)}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 print:mb-1">
            <h2 className="text-xs font-semibold tracking-widest text-neutral-400 uppercase">
              QR コード
            </h2>
            <p className="text-[11px] text-neutral-500 mt-0.5 print:hidden">
              各 Entry の顧客向けメニュー URL を QR で配布・印刷できます
            </p>
          </div>

          {entries && entries.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 print:grid-cols-3 print:gap-2">
              {entries.map((e) => (
                <QrCard
                  key={e.id}
                  title={e.label}
                  subtitle={`${KIND_LABEL[e.kind as EntryKind] ?? e.kind} / ${
                    MODE_LABEL[e.mode as EntryMode] ?? e.mode
                  }${e.is_active ? "" : " (停止中)"}`}
                  url={entryUrl(e.id)}
                  dim={!e.is_active}
                  ready={!!origin}
                  hiddenOnPrint={!!printingId && printingId !== e.id}
                  onTap={() => setQrDialog(e)}
                />
              ))}
            </div>
          ) : entries ? (
            <p className="text-sm text-neutral-400 py-8 text-center print:hidden">
              Entry を作成すると QR が表示されます
            </p>
          ) : null}
        </section>
      </main>

      {qrDialog && (
        <QrActionDialog
          entry={qrDialog}
          url={entryUrl(qrDialog.id)}
          onClose={() => setQrDialog(null)}
          onOpen={() => {
            window.open(entryUrl(qrDialog.id), "_blank", "noopener,noreferrer");
            setQrDialog(null);
          }}
          onPrint={() => {
            const id = qrDialog.id;
            setQrDialog(null);
            setPrintingId(id);
          }}
        />
      )}

      {showAddForm && (
        <AddEntryModal
          onClose={() => setShowAddForm(false)}
          onSubmit={createEntry}
        />
      )}
    </div>
  );
}

function EntryRow({
  entry,
  onToggle,
  onDelete,
}: {
  entry: Entry;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border border-neutral-100 shadow-sm p-3 flex items-center gap-3 ${
        entry.is_active ? "" : "opacity-60"
      }`}
    >
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-neutral-900 truncate">
          {entry.label}
        </h3>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[10px] text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded-full">
            {KIND_LABEL[entry.kind as EntryKind] ?? entry.kind}
          </span>
          <span className="text-[10px] text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded-full">
            {MODE_LABEL[entry.mode as EntryMode] ?? entry.mode}
          </span>
          {!entry.is_active && (
            <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
              停止中
            </span>
          )}
        </div>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={entry.is_active}
          onChange={onToggle}
          className="sr-only peer"
        />
        <div className="w-9 h-5 bg-neutral-200 rounded-full peer peer-checked:bg-neutral-900 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
      </label>
      <button
        onClick={onDelete}
        className="text-[11px] font-medium text-red-600 hover:bg-red-50 px-2.5 py-1 rounded-lg"
        title="削除"
      >
        削除
      </button>
    </div>
  );
}

function AddEntryModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: {
    label: string;
    kind: EntryKind;
    mode: EntryMode;
  }) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<EntryKind>("dine_in");
  const [mode, setMode] = useState<EntryMode>("send");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      await onSubmit({ label: label.trim(), kind, mode });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "エラー");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <h2 className="text-lg font-bold text-neutral-900 mb-1">
          Entry を追加
        </h2>
        <p className="text-xs text-neutral-500 mb-5">
          テーブル番号やテイクアウト窓口など、QR の貼付先を作成します。
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              ラベル <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例: テーブル4 / テイクアウト窓口"
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-900"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="種類"
              value={kind}
              onChange={(v) => setKind(v as EntryKind)}
              options={Object.entries(KIND_LABEL) as [EntryKind, string][]}
            />
            <SelectField
              label="モード"
              value={mode}
              onChange={(v) => setMode(v as EntryMode)}
              options={Object.entries(MODE_LABEL) as [EntryMode, string][]}
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
              disabled={submitting || !label.trim()}
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

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: [T, string][];
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-neutral-600 mb-1.5">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="appearance-none w-full pl-3 pr-9 py-2.5 rounded-xl border border-neutral-200 bg-white text-sm text-neutral-900 focus:outline-none focus:border-neutral-900"
        >
          {options.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
      </div>
    </label>
  );
}

function QrCard({
  title,
  subtitle,
  url,
  dim,
  ready,
  hiddenOnPrint,
  onTap,
}: {
  title: string;
  subtitle: string;
  url: string;
  dim?: boolean;
  ready: boolean;
  hiddenOnPrint?: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={!ready}
      className={`block w-full text-left bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 text-center transition-colors print:border-neutral-300 print:shadow-none print:break-inside-avoid hover:border-neutral-300 active:scale-[0.99] disabled:cursor-default ${
        dim ? "opacity-50" : ""
      } ${hiddenOnPrint ? "print:hidden" : ""}`}
    >
      <div className="flex justify-center">
        <div className="bg-white rounded-xl p-3">
          {ready ? (
            <QRCodeSVG
              value={url}
              size={180}
              level="M"
              marginSize={2}
              className="block"
            />
          ) : (
            <div className="w-[180px] h-[180px] bg-neutral-100 animate-pulse rounded" />
          )}
        </div>
      </div>
      <h3 className="mt-3 text-sm font-bold text-neutral-900 truncate w-full">
        {title}
      </h3>
      <p className="text-[10px] text-neutral-500 mt-0.5">{subtitle}</p>
      <p className="text-[10px] text-neutral-400 font-mono mt-2 break-all w-full">
        {url}
      </p>
    </button>
  );
}

function QrActionDialog({
  entry,
  url,
  onClose,
  onOpen,
  onPrint,
}: {
  entry: Entry;
  url: string;
  onClose: () => void;
  onOpen: () => void;
  onPrint: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-base font-bold text-neutral-900 text-center">
          {entry.label}
        </h2>
        <p className="text-[11px] text-neutral-500 text-center mt-0.5 mb-4">
          顧客向けメニュー
        </p>
        <div className="flex justify-center mb-3">
          <div className="bg-white rounded-xl p-3 border border-neutral-100">
            <QRCodeSVG value={url} size={160} level="M" marginSize={2} />
          </div>
        </div>
        <p className="text-[11px] text-neutral-500 font-mono break-all text-center mb-5">
          {url}
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="w-full py-3 rounded-xl bg-neutral-900 text-white text-sm font-semibold"
          >
            メニュー画面を開く
          </button>
          <button
            type="button"
            onClick={onPrint}
            className="w-full py-3 rounded-xl border border-neutral-200 text-sm font-medium text-neutral-700"
          >
            この QR を印刷
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-xs text-neutral-500"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-2xl border border-neutral-100 shadow-sm h-16 animate-pulse"
        />
      ))}
    </div>
  );
}
