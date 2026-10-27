# Shobji — registration lines (doc 27 theme T-B)

The package is complete inside `src/themes/shobji/`. To activate it, the
parent adds the lines below to the shared registry files — mirroring
Bazaar's registration exactly (same positions, same shapes). No other
changes are needed: instance creation works through the existing themes
POST (`packageId: "shobji"` + `SHOBJI_TOKENS` from
`src/themes/shobji/tokens.ts`), and the gallery card pattern follows
Bazaar's (import `SHOBJI_TOKENS` wherever the parent wires the
"থিম হিসেবে যোগ করুন" action).

## 1. `src/themes/registry.ts` — manifest

Add after the `BAZAAR_PACKAGE` object:

```ts
/**
 * Shobji — a sidebar grocery layout package (doc 27
 * theme T-B). A white single-tier header (wide search, solid
 * purple account button), a persistent LEFT category sidebar on
 * home and shop, a lavender hero panel with a large search box,
 * a floating purple cart tab, soft-shadow product cards with a
 * solid purple add button, and a slide-in cart drawer. Palette
 * is a designed system (purple primary, lavender surface, gold
 * accent) — hence lockPalette — and the layout is light-first,
 * hence supportsDark: false. Every option below is consumed by
 * the package's components (category sidebar + header strip;
 * floating cart tab).
 */
export const SHOBJI_PACKAGE: ThemePackage = {
  id: "shobji",
  name: "Shobji",
  nameBn: "সবজি",
  version: "1.0.0",
  author: "Advance Commerce",
  description:
    "A sidebar grocery layout — white header with wide search, a persistent left category sidebar on home and shop, lavender hero with a big search box, floating purple cart tab, cart drawer and soft-shadow cards. Best for grocery, fresh food and daily-essentials stores.",
  preview: ["#7438A8", "#EFEAF9", "#E9B949"],
  lockPalette: true,
  supportsDark: false,
  optionsSchema: [
    {
      key: "showSidebar",
      type: "boolean",
      label: "Category sidebar",
      labelBn: "ক্যাটাগরি সাইডবার",
      default: true,
    },
    {
      key: "showFloatingCart",
      type: "boolean",
      label: "Floating cart tab",
      labelBn: "ভাসমান কার্ট ট্যাব",
      default: true,
    },
  ],
  slots: {},
};
```

And register it in the map:

```ts
const THEME_PACKAGES: ReadonlyMap<string, ThemePackage> = new Map([
  [AURORA_PACKAGE.id, AURORA_PACKAGE],
  [BAZAAR_PACKAGE.id, BAZAAR_PACKAGE],
  [SHOBJI_PACKAGE.id, SHOBJI_PACKAGE],
]);
```

(change: add the `[SHOBJI_PACKAGE.id, SHOBJI_PACKAGE],` line after the
BAZAAR line.)

## 2. `src/themes/slot-registry.tsx` — server slot map

Import (after the bazaar import):

```ts
import { SHOBJI_SLOTS } from "./shobji/slots";
```

Map entry (after the bazaar entry):

```ts
const PACKAGE_SLOTS: ReadonlyMap<string, Partial<ThemeSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SLOTS],
  ["bazaar", BAZAAR_SLOTS],
  ["shobji", SHOBJI_SLOTS],
]);
```

## 3. `src/themes/client-slot-registry.tsx` — shell slots + cart drawer

Imports (after the bazaar imports):

```ts
import { SHOBJI_SHELL_SLOTS } from "./shobji/shell-slots";
import ShobjiCartDrawer from "./shobji/cart-drawer";
```

Shell map entry (after the bazaar entry):

```ts
const PACKAGE_SHELL_SLOTS: ReadonlyMap<string, Partial<ThemeShellSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SHELL_SLOTS],
  ["bazaar", BAZAAR_SHELL_SLOTS],
  ["shobji", SHOBJI_SHELL_SLOTS],
]);
```

Cart drawer map entry (after the bazaar entry):

```ts
const PACKAGE_CART_DRAWERS: ReadonlyMap<string, ThemeCartDrawerSlot> = new Map<string, ThemeCartDrawerSlot>([
  [DEFAULT_PACKAGE_ID, NullCartDrawer],
  ["bazaar", BazaarCartDrawer],
  ["shobji", ShobjiCartDrawer],
]);
```

## 4. `src/themes/client-card-registry.tsx` — ProductCard

Import (after the bazaar import):

```ts
import { ShobjiProductCard } from "./shobji/product-card";
```

Map entry (after the bazaar entry):

```ts
const PACKAGE_PRODUCT_CARDS: ReadonlyMap<string, ThemeProductCardSlot> = new Map([
  [DEFAULT_PACKAGE_ID, ProductCard],
  ["bazaar", BazaarProductCard],
  ["shobji", ShobjiProductCard],
]);
```

## 5. `src/themes/client-shop-registry.tsx` — ShopChrome

Import (after the bazaar import):

```ts
import ShobjiShopChrome from "./shobji/shop-chrome";
```

Map entry (after the bazaar entry):

```ts
const PACKAGE_SHOP_CHROME: ReadonlyMap<string, ThemeShopChromeSlot> = new Map([
  [DEFAULT_PACKAGE_ID, AuroraShopChrome],
  ["bazaar", BazaarShopChrome],
  ["shobji", ShobjiShopChrome],
]);
```

## 6. `src/themes/skin-registry.ts` — checkout skin

Import (after the bazaar import):

```ts
import { SHOBJI_CHECKOUT_SKIN } from "./shobji/checkout-skin";
```

Map entry (after the bazaar entry):

```ts
const PACKAGE_SKINS: ReadonlyMap<string, Partial<CheckoutSkin>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_CHECKOUT_SKIN],
  ["bazaar", BAZAAR_CHECKOUT_SKIN],
  ["shobji", SHOBJI_CHECKOUT_SKIN],
]);
```

## Package file set (all inside `src/themes/shobji/`)

| File | Contents |
|---|---|
| `tokens.ts` | `SHOBJI_TOKENS` (36 hand-authored tokens) + `SHOBJI_COLORS` |
| `header.tsx` | White single-tier header; solid purple account button; floating cart mounted |
| `floating-cart.tsx` | Purple right-edge cart tab (real count + subtotal, opens drawer) |
| `footer.tsx` | Five-column footer, purple styling |
| `category-sidebar.tsx` | The persistent LEFT category sidebar (home + shop); `showSidebar` gate |
| `product-card.tsx` | `ShobjiProductCard` (slot) + `ShobjiProductCardHorizontal` (rail variant) |
| `home-hero.tsx` | Lavender hero panel, own headline + big GET search, slide-image/category-tile right slot |
| `home-categories.tsx` | Popular-category tiles (image or initial tile, centred label) |
| `home-top-selling.tsx` | Featured horizontal-card rail (featured order; no sales claims) |
| `home-brands.tsx` | Real brand-name text tiles |
| `home-testimonials.tsx` | Real approved reviews |
| `home-sections.tsx` | HomeSections slot: sidebar + content composition |
| `shop-chrome.tsx` | ShopChrome slot: category sidebar + filter cards + sort bar |
| `pdp-gallery.tsx` | Thumbnail-rail gallery |
| `pdp-actions.tsx` | 2×2 action grid (WhatsApp/Call only when a number prop is passed — none is) |
| `pdp-buy-section.tsx` | BuyBoxActions-parity state machine, restyled |
| `pdp-tabs.tsx` | Description / Reviews tabs |
| `pdp-composition.tsx` | PdpComposition slot (full annotation parity) |
| `cart-drawer.tsx` | CartDrawer slot on the shared guest cart |
| `cart-page.tsx` | CartPage slot: CartPageClient in the lavender frame |
| `checkout-skin.ts` | `SHOBJI_CHECKOUT_SKIN` |
| `slots.ts` | `SHOBJI_SLOTS` (server map) |
| `shell-slots.ts` | `SHOBJI_SHELL_SLOTS` (Header + Footer) |
