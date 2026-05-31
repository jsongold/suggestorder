/**
 * Landing page.
 *
 * In production, customers always arrive via a QR code that targets
 * /e/{entry_id}. This page is a fallback for direct visits to the root.
 */
export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 px-6 text-center">
      <div className="max-w-md">
        <p className="text-[11px] uppercase tracking-widest text-neutral-400 mb-2">
          SuggestOrder
        </p>
        <h1 className="text-2xl font-bold text-neutral-900 mb-3">
          AIがあなたの注文を提案します
        </h1>
        <p className="text-sm text-neutral-500 leading-relaxed">
          店舗のQRコードを読み取って注文を始めてください。
        </p>
      </div>
    </main>
  );
}
