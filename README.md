# suggestorder

AI提案付きモバイルオーダー。**MVP Phase 1** 実装済み（e2e 5/5 pass）。

> Phase 1 スコープ: `mode=no | send` × Destination=`standalone` × Payment=`stub`
> （Square 連携・`tab` モードは Phase 2 以降）
> 詳細仕様: [`docs/mvp-phase1-spec.md`](docs/mvp-phase1-spec.md)
> 設計背景: [`PRD.md`](PRD.md), [`docs/flows.md`](docs/flows.md), [`docs/destination-payload-schemas.md`](docs/destination-payload-schemas.md), [`docs/session-design-research.md`](docs/session-design-research.md)

## 構成

```
suggestorder/
├── apps/
│   ├── api/                          # FastAPI バックエンド (Python 3.12)
│   └── web/                          # Next.js フロント (顧客 + 店舗 intake)
├── scripts/seed.py                   # 固定フィクスチャ投入（org/store/entries/products）
├── tests/test_e2e.py                 # Phase 1 happy-path e2e
├── docker-compose.yml
└── docs/mvp-phase1-spec.md           # 単一情報源
```

## 前提

- Docker
- uv (`brew install uv`)
- Node.js 20+（nvm 推奨）
- OpenAI API key

### Node セットアップ（nvm 使用時）

```bash
source ~/.nvm/nvm.sh
nvm install 20
nvm use 20
```

## クイックスタート（Makefile 使用）

```bash
make install   # 全依存インストール
make up        # DB + Redis 起動
make api       # API サーバー起動（別ターミナル）
make seed      # フィクスチャ投入 → entry_id / store_id / api_key 出力
make web       # フロント起動（別ターミナル）
make test      # e2e テスト
make stop      # 全停止
```

`make help` で全ターゲット一覧。

---

## セットアップ手順（手動）

### 1. 環境変数

`.env` を編集して `OPENAI_API_KEY` を本物に差し替え。

```bash
DATABASE_URL=postgresql+asyncpg://suggestorder:suggestorder@localhost:5432/suggestorder
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-xxx
STORE_API_KEY=test-store-key   # legacy / 未使用予定
```

### 2. DB + Redis 起動

```bash
docker compose up -d db redis
docker exec suggestorder-db-1 psql -U suggestorder -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 3. API サーバー起動

```bash
cd apps/api
uv sync
set -a && source ../../.env && set +a
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

→ http://localhost:8000/health で確認

### 4. シード投入

別ターミナル：

```bash
# Make ターゲット推奨（apps/api venv で実行 + .env 読み込み）
make seed

# 直接叩く場合は apps/api の uv 環境を使う:
cd apps/api && set -a && . ../../.env && set +a && uv run python ../../scripts/seed.py
```

`scripts/seed.py` は固定の Phase 1 フィクスチャを投入します:

- 1 Org: `Demo Cafe Org`
- 1 Store: `カフカ渋谷店`（standalone / stub / Asia/Tokyo）
- 3 Entries: `テーブル1`, `テーブル2`, `テイクアウト`
- 6 Products: `オーツラテ`, `アイスコーヒー`, `キャロットケーキ`,
  `アボカドトースト`, `ホットサンド`, `緑茶ラテ`

冪等です（実行ごとに全行を DELETE → 再投入）。完全リセットしたい場合は
`docker compose down -v` でボリュームごと消してください。

実行すると以下のような出力が出ます:

```
========================================================================
suggestorder seed complete
========================================================================
org_id    : 11111111-...  (Demo Cafe Org)
store_id  : 22222222-...  (カフカ渋谷店)
api_key   : <hex>

Products:
  - オーツラテ              ¥  620  id=...
  ...

Customer entry URLs:
  - テーブル1       (dine_in /send )  http://localhost:3000/e/<entry_id>
  - テーブル2       (dine_in /send )  http://localhost:3000/e/<entry_id>
  - テイクアウト    (takeout /send )  http://localhost:3000/e/<entry_id>

Merchant intake URL:
  http://localhost:3000/merchant/<store_id>/intake
  (X-Api-Key: <api_key>)
========================================================================
```

> `SEED_ENRICH=1 uv run python scripts/seed.py` で CatalogGen（OpenAI）で
> 説明文を再生成できますが、シードに同梱の説明文・タグで十分動きます。

### 5. フロントエンド起動

別ターミナル：

```bash
cd apps/web
npm install
npm run dev
```

### 6. ブラウザでアクセス

シード出力の URL をそのまま開きます。

| 画面 | URL |
|------|-----|
| 顧客（メニュー） | `http://localhost:3000/e/{entry_id}` |
| 店舗 intake     | `http://localhost:3000/merchant/{store_id}/intake` |
| 商品管理 (Admin) | `http://localhost:3000/admin` |

`/e/{entry_id}` は entry に紐づく store を解決し、`dine_in` / `takeout`
や `send` / `no` モードを切り替えて表示します。intake 画面は 5 秒ごとに
`/intake/{store_id}/orders` をポーリングします。

---

## 動作確認フロー

### 顧客（§8 of spec）
1. `/e/{entry_id}` を開く → 「何にしますか？」
2. タグをタップ（例: `cold` / `sweet`）→ 「提案を見る」
3. Top3 カード → 「Tab に追加」
4. （mode=send の場合）「注文する」→ 完了オーバーレイ

### 店舗 intake（§9 of spec）
1. `/merchant/{store_id}/intake` を開く
2. 新規注文が 5 秒以内にカード表示
3. `Preparing` → `Ready` → `Handed` でステータス遷移
4. 現金回収後は `Paid` ボタンで `payment_status=paid`

## e2e テスト

API 起動中に:

```bash
uv run pytest tests/test_e2e.py -v
```

`tests/conftest.py` の `seeded` フィクスチャがテストセッション開始時に
`scripts/seed.py` を 1 回だけ実行し、その出力を解析して `store_id` /
`api_key` / `entries` / `products` を全テストで共有します。

カバー範囲（Phase 1 happy path）:

- `GET /health`
- `GET /entries/{entry_id}` でコンテキスト解決
- `POST /sessions` でセッション作成 + `so_sid` クッキー
- `GET /catalog/{store_id}/products` で 6 商品
- `POST /sessions/{id}/suggest` で Top3
- `GET/POST /sessions/{id}/tab(/items)` で 2 商品をタブに追加
- `POST /sessions/{id}/tab/close` で `order_id` 取得（**冪等性**確認込み）
- `GET /intake/{store_id}/orders?status=active` で 1 件確認
- `PATCH /intake/.../status` で `preparing → ready → handed`
- `handed` は terminal → active リストから消える
- 認証ヘッダ欠落 / 不正 API key の拒否

## 開発コマンド

### 全停止
```bash
make stop
# または
pkill -f "uvicorn main:app"
docker compose down
```

### DB 初期化（全データ削除）
```bash
docker compose down -v
docker compose up -d db redis
docker exec suggestorder-db-1 psql -U suggestorder -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### API ログ確認
API はフォアグラウンドで起動するのでそのターミナルで見える。

## API エンドポイント（要約）

公開 API（顧客側、`so_sid` クッキー使用）:

| Method | Path | 用途 |
|--------|------|------|
| GET    | `/health` | ヘルスチェック |
| GET    | `/entries/{entry_id}` | エントリーコンテキスト解決 |
| POST   | `/sessions` | セッション作成/復元（クッキー発行） |
| GET    | `/catalog/{store_id}/products` | 公開カタログ |
| POST   | `/sessions/{id}/suggest` | AI 提案 |
| GET    | `/sessions/{id}/tab` | 現在のタブ取得 |
| POST   | `/sessions/{id}/tab/items` | タブにアイテム追加 |
| PATCH  | `/sessions/{id}/tab/items/{item_id}` | 数量/メモ更新 |
| DELETE | `/sessions/{id}/tab/items/{item_id}` | アイテム削除 |
| POST   | `/sessions/{id}/tab/close` | タブ確定 → destination dispatch |

店舗 intake（`X-Api-Key` ヘッダ必須。`store_id` はパスから解決）:

| Method | Path | 用途 |
|--------|------|------|
| GET    | `/intake/{store_id}/orders` | 注文一覧（`?status=active` でフィルタ） |
| GET    | `/intake/{store_id}/orders/{order_id}` | 注文詳細 |
| PATCH  | `/intake/{store_id}/orders/{order_id}/status` | ステータス更新 |
| PATCH  | `/intake/{store_id}/orders/{order_id}/payment` | 支払いステータス更新 |

Admin – Org/Store/Entry（Phase 1 では認証なし、社内オペレーション用途）:

| Method | Path | 用途 |
|--------|------|------|
| POST   | `/admin/orgs` | Org 作成 |
| GET    | `/admin/orgs` | Org 一覧 |
| POST   | `/admin/stores` | Store 作成（api_key 発行） |
| GET    | `/admin/stores` | Store 一覧（`?org_id=...` でフィルタ） |
| POST   | `/admin/stores/{store_id}/entries` | Entry 作成 |
| GET    | `/admin/stores/{store_id}/entries` | Entry 一覧 |
| PATCH  | `/admin/entries/{entry_id}` | Entry 更新（ソフト削除は `is_active=false`） |

Admin – Product（`X-Api-Key` + `X-Store-ID` ヘッダ必須）:

| Method | Path | 用途 |
|--------|------|------|
| POST/GET   | `/admin/products` | 商品作成 / 一覧 |
| PATCH      | `/admin/products/{id}` | 商品更新（バックグラウンドで AI enrich 起動） |
| PATCH      | `/admin/products/{id}/availability` | 在庫切替 |

Payment stub:

| Method | Path | 用途 |
|--------|------|------|
| POST | `/payment/stub/charge` | 常に `{status: "completed"}` を返す（Phase 1 では未配線） |

詳細リクエスト/レスポンス契約は [`docs/mvp-phase1-spec.md`](docs/mvp-phase1-spec.md) §3 参照。

## 補足

- **Square 連携は Phase 1 では stub のみ**。`Store.destination_type='standalone'` +
  `payment_channel='stub'` を seed で固定。
- **支払いフローは Phase 1 では非配線**。`tab/close` 時点では `payment_status='unpaid'`
  のままで、現金回収後に店舗が intake UI から手動で `paid` にマークします。
- **リアルタイム push は無し**。intake UI は 5 秒間隔で HTTP ポーリング。
- **Admin の Org/Store/Entry 系エンドポイントは Phase 1 では認証なし**（社内
  オペレーション想定）。Phase 2 で OAuth ベースの認可に切替予定。
- **Frontend 検証済**: `cd apps/web && npm run build` で型チェック・ビルドが
  通る状態（Next.js 16 Turbopack）。

## Cloud Run デプロイ

API と Web を Google Cloud Run にデプロイします。CI は GitHub Actions で、ワークフローはサービス別に分割されています。ブランチ名でトリガー対象が決まります（`CLAUDE.md` のブランチ命名規則と対応）:

| ワークフロー | トリガーブランチ | デプロイ対象 |
|-------------|----------------|-------------|
| `.github/workflows/deploy-api.yml` | `main`, `feat/api*` | API（`suggestorder-api`） |
| `.github/workflows/deploy-web.yml` | `main`, `feat/web*` | Web（`suggestorder-web`） |

`main` への push は両方、`feat/api-*` は API のみ、`feat/web-*` は Web のみデプロイします。

### 認証モデル

- **API は非公開**（`--no-allow-unauthenticated`）。ブラウザから直接叩けません。
- ブラウザ → Web の同一オリジン proxy（`apps/web/app/api/gcp/[...path]/route.ts`）→ Cloud Run、という経路で中継します。proxy は Google ID トークンを mint して `Authorization` に載せ、Supabase ユーザ JWT は `X-User-Authorization` で転送します（`lib/gcpAuth.ts` / `lib/proxyHeaders.ts`）。
- ID トークンの mint 方法は `GCP_AUTH_MODE` で選択（未指定時は自動判定）:
  - `vercel-oidc`: Vercel OIDC → Workload Identity Federation → SA インパーソネート（Vercel 上で動く場合）
  - `adc`: Application Default Credentials（Cloud Run / GCE のランタイム SA）。SA に `roles/run.invoker` が必要

### 必要な GitHub Secrets

| Secret | 内容 |
|--------|------|
| `WIF_PROVIDER` | Workload Identity Federation プロバイダ URI |
| `WIF_SERVICE_ACCOUNT` | デプロイ用サービスアカウント |
| `API_URL` | `https://suggestorder-api-xxx.a.run.app`（Web の build-arg 用） |

### 初回セットアップ

```bash
# 1. Artifact Registry リポジトリ作成
gcloud artifacts repositories create suggestorder \
  --repository-format=docker --location=us-central1 \
  --project=suggestorder-dev

# 2. Secret Manager にシークレット登録（deploy-api.yml が mount する 4 つ）
echo "postgresql+asyncpg://..." | gcloud secrets create DATABASE_URL        --data-file=- --project=suggestorder-dev
echo "redis://..."               | gcloud secrets create REDIS_URL           --data-file=- --project=suggestorder-dev
echo "sk-..."                    | gcloud secrets create OPENAI_API_KEY      --data-file=- --project=suggestorder-dev
echo "your-jwt-secret"           | gcloud secrets create SUPABASE_JWT_SECRET --data-file=- --project=suggestorder-dev

# 既存シークレットを更新する場合は create → versions add に変える:
# echo "new-value" | gcloud secrets versions add DATABASE_URL --data-file=-

# 3. Workload Identity Federation を設定し、GitHub Actions に keyless 認証を許可
#    https://cloud.google.com/blog/products/identity-security/enabling-keyless-authentication-from-github-actions
#    設定後、WIF_PROVIDER / WIF_SERVICE_ACCOUNT を GitHub Secrets に登録

# 4. API を一度手動デプロイして Cloud Run URL を取得し、API_URL を GitHub Secrets に登録する
#    （本番は --no-allow-unauthenticated。Web proxy / 呼び出し元 SA に roles/run.invoker が必要）
gcloud run deploy suggestorder-api \
  --image=us-central1-docker.pkg.dev/suggestorder-dev/suggestorder/api:latest \
  --region=us-central1 --platform=managed --port=8080 --no-allow-unauthenticated \
  --project=suggestorder-dev
```

### 環境変数まとめ

| サービス | 変数 | 渡し方 |
|---------|------|--------|
| API | `DATABASE_URL` / `REDIS_URL` / `OPENAI_API_KEY` / `SUPABASE_JWT_SECRET` | Secret Manager |
| API | `CORS_ORIGINS`（例: `https://suggestorder.vercel.app`） | `deploy-api.yml` の `--set-env-vars` |
| Web | `NEXT_PUBLIC_API_URL`（proxy 経由なら `/api/gcp`） | Docker build-arg（GitHub Secret `API_URL`） |
| Web | `CLOUD_RUN_API_URL` | proxy が中継する実 API URL（ランタイム env） |
| Web | `GCP_AUTH_MODE` / `GCP_*`（OIDC 用） | ランタイム env（Vercel OIDC 経路で使用） |

- API はコンテナ・Cloud Run ともに **port 8080**（`apps/api/Dockerfile`）。
- Web の `NEXT_PUBLIC_API_URL` はビルド時に焼き込まれます。proxy 方式（`/api/gcp`）なら API URL が変わっても再ビルド不要で、`CLOUD_RUN_API_URL` だけ更新すれば済みます。

---

## Phase 2 以降のロードマップ

| Phase | 内容 |
|-------|------|
| 2     | `tab` モード（累積タブ）対応 |
| 2     | Square POS destination（Orders API push） |
| 2     | Square Web Payments SDK（顧客側カード決済） |
| 3     | Square Terminal API（店内端末決済） |
| 3     | Catalog PR-style sync（MenuAdmin ↔ Square Catalog API） |
| 4     | リアルタイム push（WebSocket / SSE）、org 管理 UI |
