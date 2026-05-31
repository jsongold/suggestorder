"use client";

import { useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface GeneratedProduct {
  id: string;
  name: string;
  price: number;
}

interface ChatMessage {
  role: "user" | "ai" | "system";
  text: string;
  products?: GeneratedProduct[];
}

interface Props {
  headers: Record<string, string>;
  onCreated: () => void;
}

export default function AiCatalogChat({ headers, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "ai",
      text:
        "メニューの要望を自由に入力してください。例：「夏のさっぱりカフェメニューを 8 品」「学生向けにワンコイン以下のテイクアウト」など。",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  async function send() {
    const prompt = input.trim();
    if (!prompt || submitting) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/admin/products/generate`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const detail = await safeDetail(res);
        throw new Error(detail || `生成に失敗 (${res.status})`);
      }
      const data: {
        message: string;
        products: GeneratedProduct[];
      } = await res.json();
      setMessages((m) => [
        ...m,
        { role: "ai", text: data.message, products: data.products },
      ]);
      onCreated();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "system",
          text: e instanceof Error ? e.message : "通信エラー",
        },
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "AI チャットを閉じる" : "AI チャットを開く"}
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white transition-transform active:scale-95 hover:scale-105"
        style={{
          background:
            "conic-gradient(from 0deg, #6366f1, #8b5cf6, #ec4899, #f59e0b, #6366f1)",
        }}
      >
        <StarIcon className="w-6 h-6 drop-shadow" />
        <span className="sr-only">AI でカタログを生成</span>
      </button>

      {open && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-[min(380px,calc(100vw-2.5rem))] h-[min(560px,calc(100vh-8rem))] bg-white rounded-3xl shadow-2xl border border-neutral-200 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-100">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white"
              style={{
                background:
                  "conic-gradient(from 0deg, #6366f1, #8b5cf6, #ec4899, #f59e0b, #6366f1)",
              }}
            >
              <StarIcon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-neutral-400">
                AI Catalog
              </p>
              <p className="text-sm font-bold text-neutral-900">
                メニュー生成チャット
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-neutral-400 hover:text-neutral-700 p-1"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}
            {submitting && (
              <div className="flex gap-1.5 items-center text-xs text-neutral-400 pl-2">
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse" />
                生成中...
              </div>
            )}
          </div>

          <div className="border-t border-neutral-100 p-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="例: 夏のさっぱりカフェメニューを 8 品"
              rows={2}
              disabled={submitting}
              className="w-full resize-none px-3 py-2 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-900 disabled:opacity-50"
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-[10px] text-neutral-400">
                ⌘/Ctrl + Enter で送信
              </p>
              <button
                onClick={send}
                disabled={submitting || !input.trim()}
                className="text-xs font-semibold text-white bg-neutral-900 px-4 py-1.5 rounded-lg disabled:opacity-40"
              >
                送信
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    return (
      <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
        {message.text}
      </p>
    );
  }
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? "bg-neutral-900 text-white"
            : "bg-neutral-100 text-neutral-800"
        }`}
      >
        <p>{message.text}</p>
        {message.products && message.products.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-neutral-600">
            {message.products.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="tabular-nums">¥{p.price.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2.5l2.39 5.95L20.5 9.2l-4.7 4.1 1.45 6.2L12 16.6l-5.25 2.9 1.45-6.2-4.7-4.1 6.11-.75L12 2.5z" />
    </svg>
  );
}

async function safeDetail(res: Response): Promise<string | null> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    return null;
  } catch {
    return null;
  }
}
