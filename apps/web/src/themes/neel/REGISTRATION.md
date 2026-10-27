# Neel — registration wiring (for the integrating parent)

Theme package **T-E "Neel" (নীল)** — doc 27. The package ships
no shared-file edits; apply the exact additions below to register
it. Every snippet mirrors how `bazaar` is registered in the same
file. Tokens constant: `NEEL_TOKENS` in
`src/themes/neel/tokens.ts` (instance creation via the existing
themes POST passes `packageId` + these tokens through, as since
S4a).

---

## 1. `src/themes/registry.ts` — manifest

Add the manifest object (place it after `BAZAAR_PACKAGE`, before
the `THEME_PACKAGES` map):

```ts
/**
 * Theme #6 — Neel: a blue marketplace layout package (doc 27
 * T-E). Slim pale top strip with real links, a blue-gradient
 * main header (store name, wide white search, Sign In/Register
 * text links, Wishlist/Compare/Cart icon buttons), a signature
 * CIRCULAR category row on the home page, a hero carousel with
 * a 2×2 promo tile grid, classic marketplace cards (white, thin
 * border, wishlist heart on the platform's real wishlist,
 * orange stars only from real review data, bold black price,
 * %-off badge from real compare-at, Add To Cart + Buy Now) and
 * a slide-in cart drawer. Palette is a designed system (primary
 * blue, pale surfaces, warm-orange accent) — hence lockPalette
 * — and the layout is light-first, hence supportsDark: false.
 * Every option below is consumed by the package's components
 * (showCategoryCircles by the home category row island;
 * showPromoTiles by the home hero island).
 */
export const NEEL_PACKAGE: ThemePackage = {
  id: "neel",
  name: "Neel",
  nameBn: "নীল",
  version: "1.0.0",
  author: "Advance Commerce",
  description:
    "A blue marketplace layout — gradient header with a pale link strip, circular category row, hero with 2×2 promo tiles, classic marketplace cards with wishlist hearts and star ratings from real reviews, cart drawer. Best for general marketplaces and multi-category stores.",
  preview: ["#1773B8", "#F97A1F", "#F2F6FA"],
  lockPalette: true,
  supportsDark: false,
  optionsSchema: [
    {
      key: "showCategoryCircles",
      type: "boolean",
      label: "Show circular category row on home",
      labelBn: "হোমে বৃত্তাকার ক্যাটাগরি সারি দেখান",
      default: true,
    },
    {
      key: "showPromoTiles",
      type: "boolean",
      label: "Show hero promo tiles",
      labelBn: "হিরো প্রমো টাইল দেখান",
      default: true,
    },
  ],
  slots: {},
};
```

And add the map entry inside `THEME_PACKAGES`:

```ts
const THEME_PACKAGES: ReadonlyMap<string, ThemePackage> = new Map([
  [AURORA_PACKAGE.id, AURORA_PACKAGE],
  [BAZAAR_PACKAGE.id, BAZAAR_PACKAGE],
  [NEEL_PACKAGE.id, NEEL_PACKAGE],
]);
```

---

## 2. `src/themes/slot-registry.tsx` — server slot map

Add the import (after the bazaar import):

```ts
import { NEEL_SLOTS } from "./neel/slots";
```

Add the map entry inside `PACKAGE_SLOTS`:

```ts
const PACKAGE_SLOTS: ReadonlyMap<string, Partial<ThemeSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SLOTS],
  ["bazaar", BAZAAR_SLOTS],
  ["neel", NEEL_SLOTS],
]);
```

---

## 3. `src/themes/client-slot-registry.tsx` — shell slots + cart drawer

Add the imports (after the bazaar imports):

```ts
import { NEEL_SHELL_SLOTS } from "./neel/shell-slots";
import NeelCartDrawer from "./neel/cart-drawer";
```

Add the entry inside `PACKAGE_SHELL_SLOTS`:

```ts
const PACKAGE_SHELL_SLOTS: ReadonlyMap<string, Partial<ThemeShellSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SHELL_SLOTS],
  ["bazaar", BAZAAR_SHELL_SLOTS],
  ["neel", NEEL_SHELL_SLOTS],
]);
```

Add the entry inside `PACKAGE_CART_DRAWERS`:

```ts
const PACKAGE_CART_DRAWERS: ReadonlyMap<string, ThemeCartDrawerSlot> = new Map<string, ThemeCartDrawerSlot>([
  [DEFAULT_PACKAGE_ID, NullCartDrawer],
  ["bazaar", BazaarCartDrawer],
  ["neel", NeelCartDrawer],
]);
```

---

## 4. `src/themes/client-card-registry.tsx` — ProductCard

Add the import (after the bazaar import):

```ts
import { NeelProductCard } from "./neel/product-card";
```

Add the entry inside `PACKAGE_PRODUCT_CARDS`:

```ts
const PACKAGE_PRODUCT_CARDS: ReadonlyMap<string, ThemeProductCardSlot> = new Map([
  [DEFAULT_PACKAGE_ID, ProductCard],
  ["bazaar", BazaarProductCard],
  ["neel", NeelProductCard],
]);
```

---

## 5. `src/themes/client-shop-registry.tsx` — ShopChrome

Add the import (after the bazaar import):

```ts
import NeelShopChrome from "./neel/shop-chrome";
```

Add the entry inside `PACKAGE_SHOP_CHROME`:

```ts
const PACKAGE_SHOP_CHROME: ReadonlyMap<string, ThemeShopChromeSlot> = new Map([
  [DEFAULT_PACKAGE_ID, AuroraShopChrome],
  ["bazaar", BazaarShopChrome],
  ["neel", NeelShopChrome],
]);
```

---

## 6. `src/themes/skin-registry.ts` — checkout skin

Add the import (after the bazaar import):

```ts
import { NEEL_CHECKOUT_SKIN } from "./neel/checkout-skin";
```

Add the entry inside `PACKAGE_SKINS`:

```ts
const PACKAGE_SKINS: ReadonlyMap<string, Partial<CheckoutSkin>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_CHECKOUT_SKIN],
  ["bazaar", BAZAAR_CHECKOUT_SKIN],
  ["neel", NEEL_CHECKOUT_SKIN],
]);
```

---

## Notes for integration

- No new dependencies, no schema/migration changes, no new
  routes. Instance creation: POST a theme with `packageId:
  "neel"` and `tokens: NEEL_TOKENS` (same flow as bazaar).
- Options consumed: `showCategoryCircles` (home circular
  category row island), `showPromoTiles` (home hero island).
- Header links were verified against the app routes: /about,
  /track, /account (Sign In + Register — the account page
  carries both; there is no separate register route), /kb
  (Help), /wishlist, /compare, /search, /shop, /contact,
  /cart, /checkout all exist.
- The PDP composition passes NO WhatsApp/Call number (none is
  publicly configured in the platform), so those two action
  buttons stay omitted — the seam props exist in
  pdp-actions.tsx if a public store number is ever added.
- The PDP rating line renders only when the product carries
  real review data (`ratingAverage !== null && reviewCount >
  0`) — no placeholder 0★ row like older compositions.
