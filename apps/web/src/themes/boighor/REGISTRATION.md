# Boighor — registration wiring (for the integrating parent)

Theme package **T-C "Boighor" (বইঘর)** — doc 27. The package ships
no shared-file edits; apply the exact additions below to register
it. Every snippet mirrors how `bazaar` is registered in the same
file. Tokens constant: `BOIGHOR_TOKENS` in
`src/themes/boighor/tokens.ts` (instance creation via the existing
themes POST passes `packageId` + these tokens through, as since
S4a).

---

## 1. `src/themes/registry.ts` — manifest

Add the manifest object (place it after `BAZAAR_PACKAGE`, before
the `THEME_PACKAGES` map):

```ts
/**
 * Theme #5 — Boighor: a books-catalogue layout package (doc 27
 * T-C). Four-tier header (blue utility bar, white main header
 * with a wide rounded search, category row, pale-blue facet row
 * of plain quick links), portrait (3:4) product cards with a
 * centred title, a brand/author line, a red circular discount
 * badge and star ratings from real review data, a circular
 * category row on home, and a slide-in cart drawer. Palette is a
 * designed system (primary blue, pale blue, offer red) — hence
 * lockPalette — and the layout is light-first, hence
 * supportsDark: false. Every option below is consumed by the
 * package's components (showFacetRow by the header's tier 4;
 * cardStyle is the product card's branch point).
 */
export const BOIGHOR_PACKAGE: ThemePackage = {
  id: "boighor",
  name: "Boighor",
  nameBn: "বইঘর",
  version: "1.0.0",
  author: "Advance Commerce",
  description:
    "A books-catalogue layout — four-tier header with a blue utility bar and pale-blue facet row, portrait product cards with author line and red discount disc, circular category row, cart drawer. Best for bookshops and catalogue-style stores.",
  preview: ["#1668B4", "#D93A36", "#EAF2FB"],
  lockPalette: true,
  supportsDark: false,
  optionsSchema: [
    {
      key: "showFacetRow",
      type: "boolean",
      label: "Show facet quick-link row",
      labelBn: "ফ্যাসেট কুইক-লিংক সারি দেখান",
      default: true,
    },
    {
      key: "cardStyle",
      type: "select",
      label: "Product card style",
      labelBn: "পণ্য কার্ডের স্টাইল",
      choices: [{ value: "classic", label: "Classic (ক্লাসিক)" }],
      default: "classic",
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
  [BOIGHOR_PACKAGE.id, BOIGHOR_PACKAGE],
]);
```

---

## 2. `src/themes/slot-registry.tsx` — server slot map

Add the import (after the bazaar import):

```ts
import { BOIGHOR_SLOTS } from "./boighor/slots";
```

Add the map entry inside `PACKAGE_SLOTS`:

```ts
const PACKAGE_SLOTS: ReadonlyMap<string, Partial<ThemeSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SLOTS],
  ["bazaar", BAZAAR_SLOTS],
  ["boighor", BOIGHOR_SLOTS],
]);
```

---

## 3. `src/themes/client-slot-registry.tsx` — shell slots + cart drawer

Add the imports (after the bazaar imports):

```ts
import { BOIGHOR_SHELL_SLOTS } from "./boighor/shell-slots";
import BoighorCartDrawer from "./boighor/cart-drawer";
```

Add the entry inside `PACKAGE_SHELL_SLOTS`:

```ts
const PACKAGE_SHELL_SLOTS: ReadonlyMap<string, Partial<ThemeShellSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SHELL_SLOTS],
  ["bazaar", BAZAAR_SHELL_SLOTS],
  ["boighor", BOIGHOR_SHELL_SLOTS],
]);
```

Add the entry inside `PACKAGE_CART_DRAWERS`:

```ts
const PACKAGE_CART_DRAWERS: ReadonlyMap<string, ThemeCartDrawerSlot> = new Map<string, ThemeCartDrawerSlot>([
  [DEFAULT_PACKAGE_ID, NullCartDrawer],
  ["bazaar", BazaarCartDrawer],
  ["boighor", BoighorCartDrawer],
]);
```

---

## 4. `src/themes/client-card-registry.tsx` — ProductCard

Add the import (after the bazaar import):

```ts
import { BoighorProductCard } from "./boighor/product-card";
```

Add the entry inside `PACKAGE_PRODUCT_CARDS`:

```ts
const PACKAGE_PRODUCT_CARDS: ReadonlyMap<string, ThemeProductCardSlot> = new Map([
  [DEFAULT_PACKAGE_ID, ProductCard],
  ["bazaar", BazaarProductCard],
  ["boighor", BoighorProductCard],
]);
```

---

## 5. `src/themes/client-shop-registry.tsx` — ShopChrome

Add the import (after the bazaar import):

```ts
import BoighorShopChrome from "./boighor/shop-chrome";
```

Add the entry inside `PACKAGE_SHOP_CHROME`:

```ts
const PACKAGE_SHOP_CHROME: ReadonlyMap<string, ThemeShopChromeSlot> = new Map([
  [DEFAULT_PACKAGE_ID, AuroraShopChrome],
  ["bazaar", BazaarShopChrome],
  ["boighor", BoighorShopChrome],
]);
```

---

## 6. `src/themes/skin-registry.ts` — checkout skin

Add the import (after the bazaar import):

```ts
import { BOIGHOR_CHECKOUT_SKIN } from "./boighor/checkout-skin";
```

Add the entry inside `PACKAGE_SKINS`:

```ts
const PACKAGE_SKINS: ReadonlyMap<string, Partial<CheckoutSkin>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_CHECKOUT_SKIN],
  ["bazaar", BAZAAR_CHECKOUT_SKIN],
  ["boighor", BOIGHOR_CHECKOUT_SKIN],
]);
```

---

## Notes for integration

- No new dependencies, no schema/migration changes, no new
  routes. Instance creation: POST a theme with `packageId:
  "boighor"` and `tokens: BOIGHOR_TOKENS` (same flow as bazaar).
- Options consumed: `showFacetRow` (header tier 4),
  `cardStyle` (product-card branch point, "classic" only).
- Header tier 1 left slot is a generic delivery line, NOT a
  phone number: ThemeHeaderProps carries no public store phone.
  If a public phone prop is ever added to SiteHeaderProps, pass
  it through there.
