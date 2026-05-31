# Customer Session Design Research — suggestorder

**Research date**: 2026-05-29
**Purpose**: Inform the design of the `session` entity that sits under `org . store . entry . session` for suggestorder's QR-driven mobile ordering flow.

---

## 1. Survey of existing mobile-order / QR-table systems

The table summarises what's publicly documented (or inferable from product help pages / UI screenshots) about each system's customer-session behaviour. Cells marked "inferred" come from indirect evidence — vendor docs rarely expose the cookie/token plumbing.

| System | Session creation | Persistence | Group / shared cart | Login required | Tab / open-check semantics |
|---|---|---|---|---|---|
| **Square Online QR ordering** | New "ordering session" on QR scan; each QR encodes a station/table ID in the URL | Browser cookie + URL ID (inferred — Square's cookie policy mentions strictly-necessary session cookies that "expire when you close your browser") | No native group cart; each phone independent. Orders stack to the same table ID server-side | No (guest checkout) | Open Tabs: card pre-auth'd, auto-closes after **2h of inactivity** (text reminder at 1h) |
| **Toast Mobile Order & Pay** | QR scan opens web app, table ID baked into URL | Web session (inferred); guests can rejoin same tab by rescanning | **Group Ordering**: first guest enters contact info, creates group; others scan same QR and see "Join group X" prompt. Shared cart, single ticket | No, but contact info (name + phone/email) collected at group join | "Tabs" mode: pre-auth card, multi-round ordering, split-pay at end |
| **Bbot (DoorDash Tableside)** | QR scan → web ordering site, table number embedded or prompted | Web session; group orders use a **unique shareable URL/QR per group** | Owner-led group: first guest creates group → unique link → others join, enter name. Shared cart visible to all | No, but joiners enter display name | Group orders auto-expire after **4h of inactivity** |
| **Mobi2Go (MOBI)** | Web ordering — guests required to **sign in or create account** to order | Account-based session (auth cookie) | Not documented as first-class | **Yes** — login required | Standard order-and-pay, not tab-centric |
| **TableCheck** | Primarily reservation + payment; QR-order details not publicly documented | Inferred standard web session | Not publicly documented | Optional | Mostly pre-payment / pre-order |
| **Uber Eats Dine-In** | QR scan → opens Uber Eats web flow with location/table context | **Account session** (existing Uber account if logged in) | None — each guest orders on own account | Yes — uses existing Uber account | Order-and-pay; no open-tab pattern |
| **DoorDash Tableside (via Bbot)** | Same as Bbot | Same as Bbot | Same as Bbot | Optional | Same as Bbot |
| **Starbucks Mobile Order & Pay** | Native app, account-bound, no per-store session — contrast case | Persistent auth, stored card, Rewards account | None | **Required** | N/A — order-ahead, no in-store tab |
| **Showcase Gig (O:der Table)** | QR scan → menu screen; staff handle table state via employee app | Inferred standard web session; integrates with existing POS | Per-customer ordering at same table (each phone independent, posts to same table check) | No | After-meal payment supported via tablet/CC |
| **dinii (ダイニー)** | QR scan → **adds customer as LINE friend** automatically; identity attached via LINE userId | LINE OAuth → durable identity across visits | "**グループ機能**": multiple QR codes (one per seat) tied to one logical table; each customer scans own, all post to one bill | "Soft" — LINE friend add, no explicit login | Post-pay (退店時) default; pre-pay configurable |
| **funfo** | QR scan → menu on phone; **TableCode** (post-pay) vs **OrderCode** (pre-pay) modes | Web session (inferred) | Each guest scans, orders into same table check (TableCode) | No | TableCode = open tab → pay at end; OrderCode = pay per order |
| **Airレジ オーダー (Recruit)** | QR scan → mobile order site; QR can be **fixed per table** or per-check printed slip | Web session | Each phone independent but posts to same table check | No | Either pre-pay or after-meal seatside QR payment |
| **Sushiro QR ordering** | Mostly tablet at table; QR mainly for takeout lockers / queue tickets | Account / email-bound for takeout; tablet session for dine-in | N/A (tablet shared) | Optional | N/A |
| **McDonald's Japan Mobile Order** | **App-based**, choose dine-in table number on order screen | Persistent app login | None | Required | Order-ahead model, not tab |

### Open standards

There is **no widely-adopted open standard** for QR-table session handling. Each vendor invents its own URL pattern, cookie strategy, and group-order semantics. The closest convention is `GET https://{vendor}.tld/{store}/{table}` with the table ID in the URL — but no shared spec for tokens, group joins, or tab lifecycle.

---

## 2. Patterns observed

1. **QR encodes location, not identity.** Every system embeds `store + table/entry` in the URL. The session is created on first interaction, not at print-time. The QR is a public, long-lived pointer.
2. **Cart-in-browser, check-on-server.** Customer-side state (draft cart, taps) lives in the browser (cookie + localStorage). Committed orders become a server-side "check" tied to the table — separate from the customer session.
3. **Re-attach by rescanning.** Universal fallback. When session state is lost (closed tab, dead battery, different device), the customer rescans the same QR; server uses `table_id + open_check` to re-attach.
4. **Group ordering = two camps.**
   - **Implicit (Japanese norm — dinii, funfo, Airレジ, Showcase Gig)**: each phone is its own session; all post to one table check on the POS side. No "join a group" step.
   - **Explicit (US norm — Toast, Bbot)**: first guest creates a group; others scan and click "Join". Shared real-time cart.
5. **Tab lifecycle = inactivity timeout + payment trigger.** Tabs auto-close on inactivity (Square 2h, Bbot 4h) or on explicit checkout. Pre-auth card secures against walk-outs.
6. **Soft identity is increasingly common.** Even "no login" systems collect something — display name (Bbot), LINE friend (dinii), phone for SMS receipt (Toast group). Pure-anonymous is rare for tab-mode because the merchant needs a way to reach the customer if the tab is left open.

---

## 3. Pitfalls observed

| Pitfall | How systems mitigate |
|---|---|
| Customer takes QR sticker home and orders from outside the store | URL alone is insufficient. Some systems rate-limit / geo-fence; others rely on staff acknowledgement. dinii's LINE binding makes abuse traceable. |
| Customer scans the wrong table's QR | Table number shown prominently; some systems force confirmation ("You're ordering for Table 5 — correct?"). Staff serves to the table the order claims. |
| Reload / browser-close mid-cart | Cart in localStorage keyed by `store_id + entry_id` so rescan within seconds rehydrates. Server-side draft also kept until explicit submit. |
| Group cart desync (two phones add same item) | Toast / Bbot use server-pushed updates so all phones see same cart. Implicit-group systems sidestep by keeping carts per-phone and merging at check level. |
| Tab left open forever | Inactivity timeout + auto-close with default tip (Square); pre-auth card holds funds; SMS reminder before close. |
| Same QR scanned across visits days later | Old session dropped if check has been closed/paid, or if inactivity timeout expired. Always validate session against open-check status on the server. |
| Privacy: tracking anonymous diners | Most systems treat the session cookie as "strictly necessary" (no consent banner needed under GDPR/APPI) as long as it's *only* used for session continuity. |
| Session hijacking (shared URL) | Use opaque, high-entropy session IDs; tie session to `entry_id + UA fingerprint`; rotate token on cart commit; never put PII in URL. |

---

## 4. Recommended design for suggestorder

### Q1. Identity & creation — *Session created on first interaction, not on QR scan*

- QR encodes `https://suggestorder.com/e/{entry_id}` (or a short slug). QR carries **no session token**.
- On first GET to `/e/{entry_id}`, the server:
  - Issues an HttpOnly, Secure cookie `so_sid` (opaque 128-bit random) scoped to suggestorder.com.
  - Creates a row in `sessions` *lazily* — only persisted when the customer takes a stateful action (taps a tag, adds to cart). Pure menu browsers stay anonymous in DB.
- Session row: `id, entry_id, store_id, created_at, last_activity_at, mode_snapshot, cart_id (nullable), open_check_id (nullable, tab mode only)`.

**Why**: QR stays cacheable/shareable/public; no token leakage; idempotent rescans; no DB write for window-shoppers.

### Q2. Persistence — *Cookie for session ID, localStorage for cart draft, server for everything submitted*

| Layer | What's stored | Lifetime |
|---|---|---|
| HttpOnly cookie `so_sid` | opaque session ID | 24h sliding; `SameSite=Lax`, `Secure` |
| localStorage `cart:{entry_id}` | draft cart, AI tap history | until manually cleared or `entry_id` changes |
| Server `sessions` table | session + cart + open_check linkage | retained 30d for analytics, soft-deleted after |
| Server `checks` (tab mode) | line items committed to a tab | persists until paid / closed / 4h inactivity |

No URL tokens. No JWTs. The cookie is the session identifier; the URL is the *location* identifier.

### Q3. Re-attachment — *Same cookie + same entry_id → same session*

- Reload / reopen within 24h: cookie still valid → server looks up `so_sid` → checks `entry_id` match → rehydrates. Cart rehydrated client-side from localStorage.
- Within 5 minutes: trivially the same session.
- Within 24h, different `entry_id`: see Q4.
- Cookie expired/cleared: new session. If the `entry_id` has an open tab, prompt: "There's an open tab at this table. Resume?" (verified by tab's resume token — see Q7).

### Q4. Multi-entry — *Different entry = different session by default; carry-over prompt only in `tab` mode*

- Cookie persists, but session is keyed by `(so_sid, entry_id)`. Scanning entry B creates session B, leaving session A intact at the table.
- Exception: if both entries belong to the same `store` and entry A has an open tab in `tab` mode, prompt: "You have an open tab at Table 5. Add this order to that tab, or start new at Counter?"
- Matches dinii's "group" pattern without forcing it.

### Q5. Group ordering — *Implicit group at the table, no shared cart in v1*

- 4 people, 4 phones, 4 sessions. Each phone has its own cart and its own AI suggestions.
- All four sessions are linked to the **same `entry_id`**. In `tab` mode, they post to the same `check_id` (auto-discovered: "an open check exists at this entry → join it").
- Merchant view shows a single check with line items tagged by session ("seat 1: cappuccino, seat 2: latte").
- **Rejected**: explicit shared-cart group (Bbot/Toast style). Reasons:
  - Doubles UI complexity (real-time sync, conflict resolution, owner role).
  - The AI-suggestion UX is *personal*; a shared cart dilutes the personalization signal that's suggestorder's core differentiation.
  - Japanese norm (dinii, funfo, Airレジ) is implicit per-phone, explicit per-check — matches target market.
- **Post-v1**: add a "share my cart" read-only link.

### Q6. Authentication — *No login. Optional soft-identity for `tab` mode only*

- Modes `no` and `send`: zero identity. Cookie is the only handle.
- Mode `tab`: prompt for **display name** (Bbot pattern), optionally **phone number for SMS resume link** when the tab opens. Phone is optional but recommended because:
  - Enables tab resume across devices (text the resume link).
  - Required if pre-auth card is enabled (PCI, fraud trace).
  - APPI-compliant if purpose is disclosed and data purged after settlement (Q8).
- Explicit login (LINE, Google) **out of scope for v1**. Schema includes nullable `customer_id` FK for later.

### Q7. Edge cases

| Scenario | Behaviour |
|---|---|
| QR sticker taken home | Sessions can be opened anywhere, but in `send`/`tab` modes the order can't be served. Defence: capture IP + UA on session create; in `send`/`tab` mode, if the first order submission comes from a never-seen IP for that store, flag for staff confirmation (configurable). Pure menu browsing is unrestricted. |
| Wrong-table scan | Persistent banner "**Table 5 — Cafe X**"; 1-tap confirmation before first item submission: "Send order to **Table 5**?" After first commit, entry is locked. |
| Session persists into next visit days later | 24h sliding cookie expires before next visit in most cases. Server validates: resuming `tab` mode requires linked `check_id` to be `status=open`. Closed/paid/voided/timed-out → session invalidated, fresh start. |
| Two customers share one phone | One session, one cart by design. Want separate orders → each scans on their own phone. |
| Phone dies mid-tab | Tab survives on server (keyed by `check_id`, not session). Rescan from another device → "There's an open tab at this table — name on tab: 'Yasu'. Resume?" → enter last 4 digits of phone given at tab open (lightweight verification). Staff can override via merchant view. |
| Two open tabs at one table | Tab mode allows one open `check_id` per `entry_id`. A second open-tab attempt joins existing. For split tabs at big tables, use separate `entry`s — that's what entry granularity is for. |

### Q8. Privacy (APPI + GDPR)

- **Cookie `so_sid`**: strictly necessary, no personal data → no opt-in consent required under JP APPI 2022 amendments or GDPR ePrivacy.
- **localStorage cart**: local-only, not transmitted → no banner needed.
- **Intent/decision logs** (per PRD): anonymous, tied to random session ID. Once session row is soft-deleted at 30d, link to cookie severed. Document in privacy policy: "we collect anonymous interaction logs to improve suggestions."
- **Phone + display name** (tab mode): personal data under APPI. Required:
  - Explicit notice at input field stating purpose ("to send a tab-resume link and order confirmation").
  - Purge within 30d of tab close.
  - No third-party sharing without further consent.
  - Encrypted at rest.
- **No third-party analytics SDKs** on customer-facing flow unless gated behind a JP-compliant consent banner. `CustomerPref` per PRD is first-party — safe.
- **Cross-border data transfer** (if DB hosted outside JP): disclose in privacy policy, name the country and safeguard (SCC / adequacy).

---

## 5. Trade-offs considered & rejected

### Alternative A: URL-token session

```
https://suggestorder.com/e/{entry_id}?s={short_token}
```

- **Pros**: works without cookies (private browsing, third-party-cookie blockers).
- **Cons**: token leaks via screenshots, SMS shares, browser history; needs rotation; ugly URL; conflicts with the QR being a static printed asset.
- **Rejected**: cookie handles 99% of cases; the 1% (cookies disabled) gets a degraded "no persistence" mode — acceptable for `no`/`send`.

### Alternative B: Account-based login (Toast / Starbucks)

- **Pros**: durable identity, cross-device, loyalty, better recommendations.
- **Cons**: massive friction. suggestorder's promise is ≤3 taps; login adds 5-10 taps + OTP.
- **Rejected for v1**. Schema includes nullable `customer_id` for later layering.

### Alternative C: Explicit shared-cart group ordering (Bbot/Toast)

- **Pros**: real "we're ordering together" UX; one bill.
- **Cons**: doubles client complexity (real-time sync, ownership, kick/leave); dilutes per-person AI suggestions; group-join modal that 80% will dismiss.
- **Rejected for v1**. Implicit per-table (each phone independent → one check on the POS) gives 90% of the value with 10% of the complexity; matches JP-market norms.

---

## 6. Open questions

1. **Pre-authorization for `tab` mode** — does Square Orders API support pre-auth that suggestorder can leverage, or do we go through Square Web Payments SDK ourselves? See `square-api-research.md`.
2. **Cookie behaviour in in-app browsers** (LINE, Instagram WebView). Private cookie jars per launch are possible — needs hands-on testing. May require a URL-token fallback specifically for these UAs.
3. **Apple ITP** caps JS-set first-party cookies at 7d. Server-set HttpOnly `so_sid` isn't affected, but verify current 2026 Safari behaviour.
4. **Cardinality of `entry`** — 200-table restaurants printing 200 QRs: do they share one `store`-level menu cache? Affects caching granularity.
5. **Group-order intent signal** — even without shared cart, detect N concurrent sessions on one entry and feed into AI ranking (e.g. suggest shareable items). Not v1, but worth a `concurrent_sessions_at_entry` field.
6. **dinii's LINE-friend pattern** — interesting growth loop (every scan = follower). Worth a separate strategy discussion: LINE login as opt-in for "save preferences across visits"?
7. **APPI consent for AI personalization** — using interaction data to train a *cross-customer* model may cross from "anonymous logs" into "personal-related information" if re-identifiable. Legal review needed before training.

---

## Sources

- Square — [QR code ordering for restaurants](https://squareup.com/us/en/online-ordering/qr-code-ordering)
- Square — [Set up QR code ordering with Square Online](https://squareup.com/help/us/en/article/7142-set-up-self-serve-ordering-and-qr-codes-with-square-online)
- Square — [Open Tabs for QR Code Ordering](https://squareup.com/help/us/en/article/7680-self-serve-ordering-open-tabs-with-square-online)
- Square — [Cookie Policy](https://squareup.com/gb/en/legal/general/cookie)
- Square — [Pre-authorize payments / bar tabs](https://squareup.com/help/us/en/article/8455-enable-and-configure-preauthorization-for-bar-tabs)
- Toast — [Mobile Order & Pay FAQ](https://support.toasttab.com/en/article/Toast-Mobile-Order-and-Pay-FAQs)
- Toast — [Group Ordering on Toast MOP](https://support.toasttab.com/en/article/Group-Ordering-on-Toast-Mobile-Order-PayTM-INTERNAL)
- Toast — [Setting up Tabs & Pre-Authorization](https://support.toasttab.com/en/article/Setting-Up-Tabs-Pre-Authorization-for-Toast-Mobile-Order-Pay)
- Bbot (DoorDash) — [Ordering with Bbot](https://dd1psupport.zendesk.com/hc/en-us/articles/32479393521940-Ordering-with-Bbot)
- Bbot (DoorDash) — [Group Ordering](https://dd1psupport.zendesk.com/hc/en-us/articles/32479399772052-Group-Ordering)
- DoorDash — [Tableside Order and Pay](https://merchants.doordash.com/en-us/learning-center/tableside-order-and-pay)
- Uber Eats — [Contactless ordering for dine-in](https://www.restaurantbusinessonline.com/technology/uber-eats-adds-contactless-ordering-dine-customers)
- Mobi2Go — [GetApp listing](https://www.getapp.com/retail-consumer-services-software/a/mobi2go/)
- Starbucks — [Mobile Order & Pay FAQ](https://www.starbucks.com.sg/frequently-asked-questions-mobile-order-pay)
- Showcase Gig — [O:der Table](https://business.showcase-gig.com/lp/oder-table)
- dinii — [モバイルオーダー](https://dinii.jp/service/mobile-order/)
- dinii — [モバイルオーダー QRコードで実現するお店の未来](https://dinii.jp/mobileorderqr/)
- funfo — [店内モバイルオーダー](https://www.funfo.jp/index.php/mobileorder/)
- Airレジ オーダー — [モバイルオーダー店内版QR設置](https://faq.order.airregi.jp/hc/ja/articles/14876179647257)
- McDonald's Japan — [Mobile Order](https://www.mcdonalds.co.jp/order)
- 三宅法律事務所 — [改正個人情報保護法とCookie同意](https://www.miyake.gr.jp/notice/)
- 個人情報保護委員会 — [Cookie等の端末識別子と個人関連情報](https://www.ppc.go.jp/all_faq_index/faq1-q8-1/)
- OWASP — [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
