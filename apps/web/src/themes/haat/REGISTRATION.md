# Haat — registration instructions

Package `haat` is complete inside `src/themes/haat/`. The shared
registry files were intentionally NOT edited by the package build
(doc 27 build rules). Apply the edits below to register it — each
mirrors exactly how `bazaar` is registered in the same file.

Package tokens for the admin gallery's "add as theme" instance
creation: `HAAT_TOKENS` from `src/themes/haat/tokens.ts`
(alongside `HAAT_COLORS`).

---

## 1. `src/themes/registry.ts` — manifest

Add after the `BAZAAR_PACKAGE` declaration:

```ts
/**
 * Theme #3 — Haat: a dense, search-led marketplace layout
 * (doc 27 theme T-A). Solid orange two-tier header (slim utility
 * strip + main tier with a very wide search), no category bar,
 * a flash-style offers rail, dense square product cards with a
 * real-compare-at discount chip, a slide-in cart drawer and a
 * charcoal-banded footer. Palette is a designed system (orange
 * primary, light grey surfaces) — hence lockPalette — and the
 * layout is light-first, hence supportsDark: false. Both
 * options are consumed by the package's components (the flash
 * rail island and the hero island).
 */
export const HAAT_PACKAGE: ThemePackage = {
  id: "haat",
  name: "Haat",
  nameBn: "হাট",
  version: "1.0.0",
  author: "Advance Commerce",
  description:
    "A dense marketplace layout — solid orange two-tier header with wide search, flash-style offers rail, square product cards with discount chips, cart drawer, grey listing surfaces. Best for large general catalogues.",
  preview: ["#F26D21", "#262626", "#F5F5F5"],
  lockPalette: true,
  supportsDark: false,
  optionsSchema: [
    {
      key: "showFlashRail",
      type: "boolean",
      label: "Flash offers rail on home",
      labelBn: "হোমে আজকের অফার রেল দেখান",
      default: true,
    },
    {
      key: "heroSidePanel",
      type: "boolean",
      label: "Hero side panel",
      labelBn: "হিরোর পাশের প্যানেল দেখান",
      default: true,
    },
  ],
  slots: {},
};
```

And add the map entry in `THEME_PACKAGES`:

```ts
const THEME_PACKAGES: ReadonlyMap<string, ThemePackage> = new Map([
  [AURORA_PACKAGE.id, AURORA_PACKAGE],
  [BAZAAR_PACKAGE.id, BAZAAR_PACKAGE],
  [HAAT_PACKAGE.id, HAAT_PACKAGE],
]);
```

---

## 2. `src/themes/slot-registry.tsx` — server slot map

Add the import (after the bazaar slots import):

```ts
import { HAAT_SLOTS } from "./haat/slots";
```

Add the map entry in `PACKAGE_SLOTS`:

```ts
const PACKAGE_SLOTS: ReadonlyMap<string, Partial<ThemeSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SLOTS],
  ["bazaar", BAZAAR_SLOTS],
  ["haat", HAAT_SLOTS],
]);
```

---

## 3. `src/themes/client-slot-registry.tsx` — shell slots + cart drawer

Add the imports (after the bazaar ones):

```ts
import { HAAT_SHELL_SLOTS } from "./haat/shell-slots";
import HaatCartDrawer from "./haat/cart-drawer";
```

Add the map entry in `PACKAGE_SHELL_SLOTS`:

```ts
const PACKAGE_SHELL_SLOTS: ReadonlyMap<string, Partial<ThemeShellSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SHELL_SLOTS],
  ["bazaar", BAZAAR_SHELL_SLOTS],
  ["haat", HAAT_SHELL_SLOTS],
]);
```

Add the map entry in `PACKAGE_CART_DRAWERS`:

```ts
const PACKAGE_CART_DRAWERS: ReadonlyMap<string, ThemeCartDrawerSlot> = new Map<string, ThemeCartDrawerSlot>([
  [DEFAULT_PACKAGE_ID, NullCartDrawer],
  ["bazaar", BazaarCartDrawer],
  ["haat", HaatCartDrawer],
]);
```

---

## 4. `src/themes/client-card-registry.tsx` — ProductCard

Add the import (after the bazaar card import):

```ts
import { HaatProductCard } from "./haat/product-card";
```

Add the map entry in `PACKAGE_PRODUCT_CARDS`:

```ts
const PACKAGE_PRODUCT_CARDS: ReadonlyMap<string, ThemeProductCardSlot> = new Map([
  [DEFAULT_PACKAGE_ID, ProductCard],
  ["bazaar", BazaarProductCard],
  ["haat", HaatProductCard],
]);
```

---

## 5. `src/themes/client-shop-registry.tsx` — ShopChrome

Add the import (after the bazaar chrome import):

```ts
import HaatShopChrome from "./haat/shop-chrome";
```

Add the map entry in `PACKAGE_SHOP_CHROME`:

```ts
const PACKAGE_SHOP_CHROME: ReadonlyMap<string, ThemeShopChromeSlot> = new Map([
  [DEFAULT_PACKAGE_ID, AuroraShopChrome],
  ["bazaar", BazaarShopChrome],
  ["haat", HaatShopChrome],
]);
```

---

## 6. `src/themes/skin-registry.ts` — CheckoutSkin

Add the import (after the bazaar skin import):

```ts
import { HAAT_CHECKOUT_SKIN } from "./haat/checkout-skin";
```

Add the map entry in `PACKAGE_SKINS`:

```ts
const PACKAGE_SKINS: ReadonlyMap<string, Partial<CheckoutSkin>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_CHECKOUT_SKIN],
  ["bazaar", BAZAAR_CHECKOUT_SKIN],
  ["haat", HAAT_CHECKOUT_SKIN],
]);
```
