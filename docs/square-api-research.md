# Square API 接続リサーチ（実装計画レベル）

**作成日**: 2026-05-28
**対象**: POSConnector / MenuCatalog 連携の Square 接続
**スコープ**: Orders API / Catalog API / OAuth・Webhook
**想定言語/フレームワーク**: Python 3.12 + FastAPI（既存 `apps/api` に同居）

---

## 0. サマリ（先に結論）

- Square は **OAuth 2.0 Authorization Code Flow** でマーチャントごとに `access_token` (30日) と `refresh_token` (非有効期限) を発行する。`apps/api` 側でマーチャント単位にトークンを保管・更新する必要がある。
- 顧客の注文は **POST `/v2/orders`** → **POST `/v2/orders/{order_id}/pay`** の2ステップ。v1 では決済を行わないため `Pay` は使わず、Square 側ダッシュボードや端末で決済される運用を想定。
- メニュー同期は **`SearchCatalogItems` で全件取得 → MenuCatalog に upsert** が基本。逆方向（suggestorder → Square）は v1 では不要（merchant は Square 側で商品を管理する想定）。
- Webhook は **`order.created` / `order.updated` / `order.fulfillment.updated` / `catalog.version.updated` / `oauth.authorization.revoked`** を購読。**HMAC-SHA256** で署名検証必須。
- 公式 **Python SDK `squareup`** (>= 44.x, Python 3.8+) が存在し、Webhook 署名検証ヘルパーも同梱。基本的にこれを使い、薄く Port/Adapter 化する。

---

## 1. 全体アーキテクチャ（PRD のサービス境界に当てはめる）

```
[Merchant Square Dashboard]
         │
         ├─ OAuth 認可 ──► [MenuAdmin (FE)] ──► [apps/api: SquareAuthService]
         │                                       │ access_token / refresh_token (per merchant)
         │                                       ▼
         │                                  [DB: square_tokens]
         │
         ├─ Catalog 変更 (Webhook) ──► [POSConnector.SquareAdapter] ──► [MenuCatalog]
         │                                  Pull: SearchCatalogItems
         │
         └─ Order 受信 (Webhook) ──► [POSConnector.SquareAdapter]
                                          ◄─ Push: CreateOrder (顧客フローから)
```

- `apps/api/services/adapters/` 配下に `square/` を新設し、`SquareClient` 薄いラッパ＋ Catalog/Orders/Webhook の3アダプタを置く。
- 既存 `services/ports.py` にあたるインターフェース層に `POSConnectorPort` / `CatalogSourcePort` を追加し、Square 実装をそこに差し込む。

---

## 2. 認証基盤（OAuth 2.0）

### 2.1 採用フロー

| フロー | 用途 | 備考 |
|--------|------|------|
| **Code Flow** | サーバ側 MenuAdmin 経由（推奨） | `client_secret` を保管。refresh_token 非失効 |
| PKCE Flow | モバイル/SPA 直結 | refresh_token が 90日で失効するため v1 では不採用 |

### 2.2 エンドポイント

| 用途 | Method / URL |
|------|--------------|
| 認可ページ（ユーザを誘導） | `GET https://connect.squareup.com/oauth2/authorize` |
| トークン取得・更新 | `POST https://connect.squareup.com/oauth2/token` |
| トークン失効 | `POST https://connect.squareup.com/oauth2/revoke` |
| Sandbox | `https://connect.squareupsandbox.com/oauth2/...` |

### 2.3 必要 scope（最小権限）

| Scope | 用途 |
|-------|------|
| `MERCHANT_PROFILE_READ` | location 一覧取得（QR→location 紐付け） |
| `ITEMS_READ` | Catalog 同期 |
| `ORDERS_READ` | 既存注文の状態取得・Webhook 受信 |
| `ORDERS_WRITE` | suggestorder からの CreateOrder |
| （将来）`PAYMENTS_WRITE` | アプリ内決済（v1 では不要） |
| （将来）`INVENTORY_READ` | 在庫連動 Guardrail |

### 2.4 トークンの有効期限と扱い

- `access_token`: **30日** で失効。失効前にバックエンドジョブで `refresh_token` から再取得する。
- `refresh_token`（Code Flow）: **非失効**。マーチャント側で revoke されるか、`oauth.authorization.revoked` Webhook を受信した時点で DB から削除。
- 認可コード: **5分**で失効。コールバック受信後ただちに `ObtainToken` を呼ぶ。

### 2.5 DB スキーマ追加案

```sql
CREATE TABLE square_credentials (
  store_id          UUID PRIMARY KEY REFERENCES stores(id),
  merchant_id       TEXT NOT NULL,            -- Square 側 merchant_id
  access_token      TEXT NOT NULL,            -- 必ず暗号化 (pgcrypto or app-level)
  refresh_token     TEXT NOT NULL,            -- 同上
  expires_at        TIMESTAMPTZ NOT NULL,
  scopes            TEXT[] NOT NULL,
  default_location_id TEXT,                   -- 既定 location
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
```

> セキュリティ要件: token は必ず保存時に暗号化。`.env` の `SQUARE_TOKEN_ENCRYPTION_KEY` を別途設ける。

---

## 3. Catalog API（メニュー同期）

### 3.1 主な CatalogObject タイプ

| Type | 説明 | 対応する MenuCatalog 概念 |
|------|------|---------------------------|
| `ITEM` | 商品 | products |
| `ITEM_VARIATION` | サイズ/価格バリエーション | product_variants（要追加） |
| `CATEGORY` | カテゴリ | tags or categories |
| `IMAGE` | 画像 | products.image_url |
| `TAX` | 税設定 | （v1 は無視。COMPLETED 時に Square が計算） |
| `MODIFIER_LIST` | カスタマイズ | （v1 範囲外） |

### 3.2 利用エンドポイント

| 用途 | エンドポイント | 備考 |
|------|----------------|------|
| 全件同期（初回） | `POST /v2/catalog/search-catalog-items` | `text_filter` / `category_ids` / `enabled_location_ids` でフィルタ可能。cursor でページング |
| 個別取得 | `GET /v2/catalog/object/{object_id}` | Webhook で差分検知後の取得用 |
| 一覧（型指定） | `GET /v2/catalog/list?types=ITEM,IMAGE` | type 限定の軽量版 |
| バッチ | `POST /v2/catalog/batch-retrieve` | 最大 10,000 件 |
| Upsert（逆同期、v2 以降） | `POST /v2/catalog/object` / `batch-upsert` | v1 では使わない |

### 3.3 同期戦略（v1）

```
[初回]
  SearchCatalogItems → cursor 完走まで → MenuCatalog upsert
       └─ 画像は IMAGE オブジェクトの url を別途取得して S3 等にミラー（任意）

[継続]
  catalog.version.updated Webhook 受信
     ↓
  最終同期時刻以降の差分のみ SearchCatalogObjects (begin_time 指定) で取得
     ↓
  MenuCatalog upsert
```

### 3.4 注意点

- Catalog の更新は **sparse update 不可**。Upsert は必ず全フィールドを送る必要がある（v1 では readonly なので影響なし、将来注意）。
- `enabled_location_ids` を必ず指定して、店舗ごとに有効な商品だけを取得する。
- 価格は `ITEM_VARIATION.item_variation_data.price_money.amount`（最小通貨単位、JPY は円整数）。

---

## 4. Orders API（注文連携）

### 4.1 注文ライフサイクル

```
[DRAFT] ──┐
          ▼
        [OPEN] ── pay ──► [COMPLETED]
          │
          └── cancel ────► [CANCELED]
```

- `CreateOrder` は既定で **OPEN** で生成される。
- v1 では決済をアプリ内で行わないため、Square 側で支払い処理（端末/Dashboard/別決済）→ 自動的に COMPLETED 遷移を Webhook で観測する。

### 4.2 利用エンドポイント

| 用途 | エンドポイント | scope |
|------|----------------|-------|
| 注文作成 | `POST /v2/orders` | `ORDERS_WRITE` |
| 状態取得 | `GET /v2/orders/{order_id}` | `ORDERS_READ` |
| 更新（version 必要） | `PUT /v2/orders/{order_id}` | `ORDERS_WRITE` |
| 支払い実行（v1 不使用） | `POST /v2/orders/{order_id}/pay` | `ORDERS_WRITE` + `PAYMENTS_WRITE` |
| 検索 | `POST /v2/orders/search` | `ORDERS_READ` |

### 4.3 CreateOrder リクエスト最小形（v1）

```json
POST /v2/orders
Authorization: Bearer {access_token}
{
  "idempotency_key": "0c8e9f8e-...-uuid",
  "order": {
    "location_id": "L7Y...",
    "reference_id": "suggestorder:<session_id>",
    "source": { "name": "suggestorder.com" },
    "line_items": [
      {
        "catalog_object_id": "ITEM_VAR_XYZ",
        "quantity": "1"
      }
    ],
    "fulfillments": [
      {
        "type": "PICKUP",
        "state": "PROPOSED",
        "pickup_details": {
          "recipient": { "display_name": "Table 5" },
          "pickup_at": "2026-05-28T12:30:00Z"
        }
      }
    ]
  }
}
```

- `catalog_object_id` 参照型を使うと **価格・税・カテゴリが Square 側から自動継承**される（ad hoc にしない）。
- `reference_id` に suggestorder 側の `session_id` / `cart_id` を入れて双方向トレース可能にする。
- `fulfillments[0].type` は QR 紐付けから決定：店内 → `PICKUP`（or `SHIPMENT`）、テイクアウト → `PICKUP`。

### 4.4 Idempotency

- すべての書き込み API で `idempotency_key` は **UUID 推奨**。
- 同一 key で同一 body を再送 → 初回レスポンスが返る（重複防止）。
- 同一 key で異なる body を再送 → エラー。
- suggestorder 側では `session_id + cart_version` から決定論的に UUID を生成して保管。

### 4.5 楽観的ロック

- `Order.version` は更新ごとに +1。`UpdateOrder` 呼び出し時は **必ず最新 version** を指定。
- Webhook 受信時の version と DB の version を比較し、古ければスキップ。

---

## 5. Webhook

### 5.1 購読すべきイベント（v1）

| Event | 用途 |
|-------|------|
| `order.created` | Square 側（POS 端末等）で作成された注文を取り込み |
| `order.updated` | 数量・金額変更の取り込み |
| `order.fulfillment.updated` | PROPOSED → RESERVED → PREPARED → COMPLETED の追従 |
| `catalog.version.updated` | Catalog 差分同期トリガ |
| `oauth.authorization.revoked` | トークン削除 |

### 5.2 設定方法

- Developer Console > アプリ > Webhooks > Subscriptions で `Add subscription`。
- **HTTPS 必須**。通知 URL 例：`https://api.suggestorder.com/webhooks/square`。
- 作成時に発行される **signature key** を `.env` の `SQUARE_WEBHOOK_SIGNATURE_KEY` に保管。

### 5.3 署名検証（FastAPI 実装スケッチ）

```python
# apps/api/routers/webhooks.py
import os
from fastapi import APIRouter, Request, HTTPException, Header
from square.utilities.webhooks_helper import is_valid_webhook_event_signature

router = APIRouter()

SIGNATURE_KEY = os.environ["SQUARE_WEBHOOK_SIGNATURE_KEY"]
NOTIFICATION_URL = os.environ["SQUARE_WEBHOOK_URL"]  # 登録した完全URL

@router.post("/webhooks/square")
async def square_webhook(
    request: Request,
    x_square_hmacsha256_signature: str = Header(...),
):
    raw_body = await request.body()  # 必ず raw bytes で
    if not is_valid_webhook_event_signature(
        raw_body.decode("utf-8"),
        x_square_hmacsha256_signature,
        SIGNATURE_KEY,
        NOTIFICATION_URL,
    ):
        raise HTTPException(status_code=401, detail="invalid signature")

    event = await request.json()
    # dispatch by event["type"]
    return {"ok": True}
```

> **timing-safe 比較は SDK ヘルパが内部で実施**。自前実装する場合は `hmac.compare_digest` を使う。

### 5.4 リトライ

- Square は失敗時に指数バックオフでリトライ。
- 受信エンドポイントは **冪等** に作る（`event_id` を DB に記録して重複処理スキップ）。
- 2xx を返す前に重い処理を行わない（ジョブキューに積んで先に 200 を返す）。

---

## 6. Sandbox / テスト

- Sandbox base URL: `https://connect.squareupsandbox.com`
- Developer Console > Sandbox test accounts で最大 10 個のテストマーチャント作成可能。
- Sandbox トークンは本番では使えない（環境完全分離）。
- 実在クレジットカードは受け付けない。テスト用カード値は別途ドキュメント参照。
- `.env` を `SQUARE_ENV=sandbox|production` で切替できる構造にしておく。

---

## 7. Python SDK

```bash
# apps/api/pyproject.toml に追加
uv add squareup
```

```python
# apps/api/services/adapters/square/client.py
import os
from square import Square, AsyncSquare

def get_async_client(access_token: str) -> AsyncSquare:
    return AsyncSquare(
        token=access_token,
        environment="sandbox" if os.environ.get("SQUARE_ENV") == "sandbox" else "production",
    )
```

- 自動ページング・リトライ・タイムアウト（既定 60s）対応。
- Webhook 署名検証ヘルパは `from square.utilities.webhooks_helper import is_valid_webhook_event_signature`。
- 非同期版 `AsyncSquare` を採用し、既存 FastAPI のイベントループと統合。

---

## 8. POSConnector に必要な抽象（実装プラン）

```python
# apps/api/services/ports.py に追加
from typing import Protocol

class POSConnectorPort(Protocol):
    async def create_order(self, store_id: UUID, cart: Cart) -> POSOrderRef: ...
    async def get_order(self, store_id: UUID, ref: POSOrderRef) -> POSOrder: ...

class CatalogSourcePort(Protocol):
    async def list_items(self, store_id: UUID, since: datetime | None) -> AsyncIterator[POSCatalogItem]: ...
```

```
apps/api/services/adapters/square/
├── __init__.py
├── client.py            # SDK 初期化、トークン更新
├── auth.py              # OAuth code 交換、refresh、revoke
├── catalog_adapter.py   # CatalogSourcePort 実装
├── orders_adapter.py    # POSConnectorPort 実装
└── webhooks.py          # イベント→内部 domain event 変換
```

---

## 9. 実装ロードマップ

### Phase 1: 認証基盤
- [ ] Square Developer アプリ作成（Sandbox + Production）
- [ ] `.env` に `SQUARE_APP_ID` / `SQUARE_APP_SECRET` / `SQUARE_ENV` / `SQUARE_WEBHOOK_SIGNATURE_KEY` 追加
- [ ] `square_credentials` テーブル追加（マイグレーション）
- [ ] OAuth コールバックエンドポイント `/admin/square/oauth/callback`
- [ ] refresh ジョブ（cron もしくは on-demand）

### Phase 2: Catalog 同期（読み取り専用）
- [ ] `SearchCatalogItems` で初回フル同期
- [ ] MenuCatalog への upsert ロジック（external_id = Square ITEM_VARIATION id）
- [ ] `catalog.version.updated` Webhook → 差分同期

### Phase 3: Orders 連携
- [ ] `CreateOrder` 呼び出しを `POSConnectorPort.create_order` 実装に追加
- [ ] `Order.id` を suggestorder の `orders.external_ref` に保存
- [ ] `order.updated` / `order.fulfillment.updated` Webhook で状態追従

### Phase 4: Webhook 基盤
- [ ] `/webhooks/square` エンドポイント + 署名検証
- [ ] 受信イベントを `square_events` テーブルに記録（冪等用）
- [ ] 重要イベントは内部 Pub/Sub にディスパッチ

### Phase 5: ガードレール / 失敗系
- [ ] `oauth.authorization.revoked` 受信時の credential 削除 + アラート
- [ ] CreateOrder 失敗時の Menu 側エラー表示
- [ ] レート制限ハンドリング（Square は per-merchant のレート制限あり）

---

## 10. 既知の制約・注意事項

| 項目 | 内容 |
|------|------|
| Catalog Update | sparse update 不可。フル オブジェクト送信が必要 |
| Orders 同時更新 | per-seller 1 リクエスト直列処理。version 楽観ロック必須 |
| Sandbox 機能差分 | サブスクリプション、領収書発行、返金など一部未対応 |
| 通貨 | `Money.amount` は最小通貨単位（JPY は円）。フロント表示時の division 不要 |
| タイムアウト | SDK 既定 60s。長時間処理（Catalog 一括取得）は別ジョブで |
| マルチロケーション | 1 merchant 複数 location あり。QR → location_id マッピング必須 |
| トークン保管 | アプリ層で必ず暗号化。生 token をログ出力しない |

---

## 11. 参考リンク

- [Square API Reference](https://developer.squareup.com/reference/square)
- [Orders API: How It Works](https://developer.squareup.com/docs/orders-api/how-it-works)
- [POST /v2/orders](https://developer.squareup.com/reference/square/orders-api/create-order)
- [Order Object](https://developer.squareup.com/reference/square/objects/Order)
- [Catalog API Reference](https://developer.squareup.com/reference/square/catalog-api)
- [SearchCatalogItems](https://developer.squareup.com/reference/square/catalog-api/search-catalog-items)
- [OAuth API Overview](https://developer.squareup.com/docs/oauth-api/overview)
- [OAuth Permissions Reference](https://developer.squareup.com/docs/oauth-api/square-permissions)
- [Webhooks: Subscribe](https://developer.squareup.com/docs/webhooks/step2subscribe)
- [Webhooks: Validate Signature](https://developer.squareup.com/docs/webhooks/step3validate)
- [Webhook Events Reference](https://developer.squareup.com/docs/webhooks/v2webhook-events-tech-ref)
- [Idempotency](https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency)
- [Sandbox Overview](https://developer.squareup.com/docs/devtools/sandbox/overview)
- [Python SDK (squareup)](https://github.com/square/square-python-sdk)
