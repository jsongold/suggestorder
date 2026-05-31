# Menu Catalog UX Research (2024–2026)

For: `suggestorder` — QR-triggered, AI-assisted mobile ordering for cafes/restaurants. Focus: the **menu catalog screen** (step 2 in the flow), the customer's first real impression and the launchpad into the AI inquiry funnel.

---

## 1. Executive Summary

- **Image-first, asymmetric 2-up cards win.** Best-in-class apps (Uber Eats, Wolt, Sweetgreen, Starbucks) have abandoned dense text lists in favor of large, food-forward photo cards. A bento-influenced 2-column grid with one oversized "hero" card per scroll viewport is the dominant 2024–2026 pattern.
- **Sticky everything.** A sticky top bar (search + category chips) and a sticky bottom CTA (cart / "Ask AI") are now table stakes. iOS 26's *Liquid Glass* material is the modern visual treatment for both surfaces — translucent, refractive, sitting *above* content.
- **AI gets a dedicated, persistent surface — not a hidden menu item.** Spotify DJ, Pinterest AI boards, and Kroger's redesign all use a single floating, prominently-styled entry point. For suggestorder, the AI inquiry should be a sticky bottom-of-screen card or pill, visible from the first scroll.
- **Bottom sheets, not new screens, for item detail.** Modal bottom sheets keep users anchored in the menu context, preserve scroll position, and feel native on both iOS 26 and Material 3.
- **Social proof + curation labels drive engagement.** "Popular," "Chef's pick," "X ordered today," and "Recommended for you" badges measurably lift conversion and pull users into discovery flows rather than passive scrolling.

---

## 2. Current State of Menu UX in Top Apps

**Uber Eats / DoorDash.** Both use a sticky search bar, horizontally-scrolling category chips that pin to the top on scroll, and vertical lists of medium-density cards (image left, text right on iOS; image-top on newer Android builds). DoorDash 2024 leans into "DashPass" badges and "Most liked" tags as inline social proof. Uber Eats has standardized on the `ActionCard` pattern — a single card with one primary action and an optional secondary chip — across the app.

**Wolt.** Cleanest of the three. Square 1:1 photo, oversized item name, price as a separate chip below the image, allergen icons inline. Uses asymmetric grids on featured rails and falls back to single-column for full menus.

**Sweetgreen / Starbucks.** Both prioritize **personalization signals**. Starbucks opens directly to "Featured" with large editorial-style hero cards before showing the menu grid. Sweetgreen's mobile app uses bold typography and full-bleed photography; "Build your own" is given an outsized card to drive engagement vs. passive scroll.

**Chipotle / Sweetgreen / Domino's.** Quick-add (+ button on the card) is universal for items with no required customization; tap-to-detail opens a bottom sheet for customizable items. This split reduces friction without losing upsell opportunities.

**McDonald's / Starbucks.** Both use **time-aware menus** — breakfast vs. lunch shifts the top of the catalog automatically. A 2025 trend now spreading: weather- and daypart-aware reordering of the catalog.

**Resy / OpenTable.** Less relevant for ordering, but their *editorial card* treatment (large photo, italic chef quote, location tag) is the gold standard for "storytelling per item" — a pattern worth borrowing for suggestorder's "featured" rail.

**Japan: 食べログ / ぐるなび / Rakuten Gurunavi.** More text-dense than Western counterparts; rely on user-uploaded photos which are inconsistent. The **QR-to-smartphone-menu pattern is now in ~50% of Japanese restaurants** (Unseen Japan, 2024), but most implementations are poor: PDF-like lists, no photos, no search. This is suggestorder's opportunity — the bar is genuinely low domestically.

---

## 3. Trending Patterns for 2024–2026

**Liquid Glass (iOS 26).** Translucent, refractive material applied to *floating* UI: nav bars, tab bars, floating action buttons, sticky CTAs. Apple's own guidance: "Liquid Glass sits on top of your UI; content sits underneath." Kroger's 2026 redesign is the canonical food/commerce example — a floating Liquid Glass "Delivery/Pickup" toolbar persists across the shopping flow.

**Bento grids.** Asymmetric, compartmentalized layouts inspired by Japanese bento boxes. In menus, this means one large card (hero/featured item) plus a 2-up grid of smaller cards in the same viewport, rather than a uniform 2-column wall. Breaks scroll monotony and creates visual hierarchy.

**Sticky filter chips with horizontal scroll.** The category strip pins to the top on scroll. Tapping a chip jump-scrolls (anchored) to that section. Active chip uses a filled pill; inactive chips are outlined. This is now standard across Uber Eats, Wolt, DoorDash, and Apple's own Wallet/Order surfaces.

**Skeleton loading + image blur-up.** Gray skeleton blocks for card structure, then progressive image load with a tiny base64 blur placeholder. Users perceive load time as ~30% faster than spinner-based loads (NN/g).

**Conversational AI as a dedicated surface, not a chat bubble.** Spotify DJ's blue tile, Pinterest's AI boards, ChatGPT's persistent input bar — all treat AI as a *first-class navigation destination*, not a hidden helper. Most 2025 food apps fail at this; they bury AI behind a menu icon.

**Quick-add micro-interactions.** Tap "+" → button morphs into stepper (-, count, +) with spring animation. Card briefly elevates. Haptic tap on iOS. This is the single highest-ROI animation in food apps right now.

**Sticky bottom CTA.** As cart fills, a persistent bar slides up: "View cart (¥1,200) →". A/B tests consistently show sticky CTAs outperform inline-only CTAs by 10–20% on mobile checkout flows (AB Tasty).

---

## 4. Recommended Pattern Stack for `suggestorder`

Opinionated picks. Implementable in Next.js + Tailwind.

| Decision | Recommendation | Why |
|---|---|---|
| **Layout** | Sticky header → horizontal category chips → bento-influenced grid: 1 hero card + 2-up grid below | Breaks monotony; signals "we curated this" |
| **Card image** | 4:3 aspect, top-down or 45° angle, full-bleed top of card | 4:3 packs more cards per viewport than 1:1 while keeping food legible |
| **Card content** | Photo → name (16px semibold) → 1-line description (13px, muted) → price (15px bold, no ¥ glyph repetition in price line; show "¥" once) | Scannable; price prominent but not shouty |
| **Hero card** | Full-width, 16:9, overlaid gradient with "本日のおすすめ" or "Chef's pick" badge top-left | Editorial feel, sets the brand tone |
| **Badges** | Small pill, top-left of image: "人気" / "新作" / "残りわずか". Allergen icons bottom-right of image | Visible without dominating |
| **Quick-add** | Floating "+" circle, bottom-right of each card; morphs to stepper on tap | Industry-standard, low friction |
| **Detail view** | Modal bottom sheet, 85% screen height, drag-to-dismiss | Preserves menu context |
| **Sticky top** | Liquid Glass treatment (`backdrop-blur-xl bg-white/70`), contains: store name, search icon, category chips | Modern, on-trend, performant |
| **Sticky bottom (AI entry)** | Persistent pill: "AIに今日の気分を伝える →" with subtle gradient + spark icon. Always visible from first scroll. | This *is* the funnel into step 3. Cannot be hidden. |
| **Sticky bottom (cart)** | Slides up only when cart > 0, sits above the AI pill or replaces it contextually | Don't take screen real estate until earned |
| **Motion language** | Spring-based (`framer-motion` `stiffness: 300, damping: 30`), 200–300ms. Card entrance: fade + 8px translate-up, staggered 30ms | Feels native, not webby |
| **Loading** | Skeleton cards matching final layout; image blur-up via `next/image` `placeholder="blur"` | Perceived speed |
| **Personalization** | "Recommended for you" rail appears *after* AI inquiry completes once — not on first visit (no data yet) | Honest UX; avoids fake personalization |
| **Out-of-stock** | Card stays visible, image desaturates to 40%, "本日売切" overlay, quick-add disabled | Don't hide; signals popularity |

---

## 5. Mockup (ASCII)

```
┌─────────────────────────────────────────┐
│ ◐ Cafe Komorebi          🔍   ⋯         │ ← Liquid Glass sticky header
│ [おすすめ] ドリンク フード スイーツ ... │ ← horizontal scroll chips
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ │
│ │ ░░░  HERO PHOTO (16:9)         ░░░ │ │ ← bento hero card
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ │
│ │ [本日のおすすめ]                    │ │
│ │ 季節のフルーツタルト         ¥780  │ │
│ │ 旬の苺と自家製カスタード            │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌──────────────┐  ┌──────────────┐     │
│ │ ░░PHOTO 4:3░░│  │ ░░PHOTO 4:3░░│     │
│ │ [人気]       │  │              │     │
│ │              │  │              │  ⊕  │ ← floating quick-add
│ │ ラテ    ¥520│  │ アメリカーノ │     │
│ │         ⊕   │  │ ¥420    ⊕   │     │
│ └──────────────┘  └──────────────┘     │
│                                         │
│ ┌──────────────┐  ┌──────────────┐     │
│ │ ░░░░░░░░░░░░ │  │ ░░░░░░░░░░░░ │     │
│ │ [売切]grayed │  │              │     │
│ │ チーズケーキ │  │ ガトーショコラ│    │
│ │ ¥620         │  │ ¥640    ⊕   │     │
│ └──────────────┘  └──────────────┘     │
│                                         │
│         (scroll continues...)           │
│                                         │
├─────────────────────────────────────────┤
│ ✦ AIに今日の気分を伝える →             │ ← Liquid Glass AI pill (sticky)
└─────────────────────────────────────────┘
```

Thumb zone: AI pill and quick-add buttons sit in the bottom-third of the screen, reachable one-handed. Search and brand sit in the top zone (deliberately less-tapped).

---

## 6. Anti-Patterns to Avoid

- **PDF-style text menus.** The default Japanese QR-menu pattern. Kills first impression instantly.
- **Hamburger menu for categories.** Hides discovery. Use horizontal chips.
- **Generic chatbot bubble for AI.** A floating chat icon in the corner signals "support," not "discovery." Use a labeled pill with a clear value prop ("今日の気分を伝える").
- **Auto-playing video on every card.** Drains battery, jarring on mobile data. Use video only on the hero, muted, looping, and only above-the-fold.
- **Modal popups for upsells on entry.** Erodes trust before the user has even seen the menu.
- **3+ column grids on mobile.** Cards become too small to evaluate food quality; defeats the purpose of image-first.
- **Hiding price until detail view.** Friction + distrust. Price must be on the card.
- **Sticky header that takes >15% of screen.** Liquid Glass is gorgeous but must stay compact (max ~88pt including chips).
- **Fake personalization on first visit.** "Recommended for you" with no data feels dishonest. Earn it.
- **Removing out-of-stock items silently.** Users notice gaps; desaturate and label instead.
- **Animations >400ms.** Feels sluggish on second visit. Keep motion in the 150–300ms band.

---

## 7. References

- [Apple — iOS 26 Liquid Glass Design Gallery](https://developer.apple.com/design/new-design-gallery-2026/)
- [Apple Newsroom — Liquid Glass introduction (2025)](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
- [MacRumors — iOS 26 Liquid Glass guide](https://www.macrumors.com/guide/ios-26-liquid-glass/)
- [Uber Engineering — ActionCard design pattern](https://www.uber.com/blog/developing-the-actioncard-design-pattern/)
- [Baymard Institute — Uber Eats UX case study](https://baymard.com/ux-benchmark/case-studies/uber-eats)
- [Muzli — Bento Style & Compartmentalisation in UI](https://medium.muz.li/bento-style-compartmentalisation-in-ui-design-a0f82557a055)
- [Wolt Engineering — Icon system redesign](https://careers.wolt.com/en/blog/tech/wolt-icon-system-redesign)
- [NN/g — Bottom Sheets UX Guidelines](https://www.nngroup.com/articles/bottom-sheet/)
- [Mobbin — Food & Drink mobile app patterns](https://mobbin.com/explore/mobile/app-categories/food-drink)
- [Smashing Magazine — Sticky Menus UX Guidelines](https://www.smashingmagazine.com/2023/05/sticky-menus-ux-guidelines/)
- [Sunday — QR Code Ordering: From Trend to Standard 2025](https://sundayapp.com/qr-code-ordering-from-trend-to-standard-in-2025/)
- [Unseen Japan — QR ordering adoption & backlash in Japan](https://unseen-japan.com/qr-code-restaurant-ordering-japan-backlash/)
- [Spotify Newsroom — AI DJ launch & voice requests](https://newsroom.spotify.com/2025-05-13/dj-voice-requests/)
- [AB Tasty — Sticky CTAs on mobile](https://www.abtasty.com/blog/mobile-stick-to-scroll/)
- [BentoBox — iPhone food photography for restaurants](https://www.getbento.com/blog/iphone-food-photography-restaurants/)
- [MenuCapture — Restaurant food photography 2025](https://www.menucapture.com/restaurant-food-photography-guide)
- [Medium / Suketu Prajapati — Food delivery UI/UX 2025](https://medium.com/@prajapatisuketu/food-delivery-app-ui-ux-design-in-2025-trends-principles-best-practices-4eddc91ebaee)
- [Weavers Web — Food delivery app design principles 2025](https://weaversweb.com/6-essential-ui-ux-design-principles-for-food-delivery-apps-in-2025/)
- [Kore.ai — Conversational AI in food ordering](https://blog.kore.ai/enhancing-food-ordering-with-conversational-ai-and-generative-ai)
