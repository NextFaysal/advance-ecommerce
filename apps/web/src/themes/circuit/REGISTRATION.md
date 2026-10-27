# Circuit — registration wiring (for the integrating parent)

Theme package **T-D "Circuit" (সার্কিট)** — doc 27. The package ships
no shared-file edits; apply the exact additions below to register
it. Every snippet mirrors how `bazaar` is registered in the same
file. Tokens constant: `CIRCUIT_TOKENS` in
`src/themes/circuit/tokens.ts` (instance creation via the existing
themes POST passes `packageId` + these tokens through, as since
S4a).

---

## 1. `src/themes/registry.ts` — manifest

Add the manifest object (place it after `BAZAAR_PACKAGE`, before
the `THEME_PACKAGES` map):

```ts
/**
 * Theme #6 — Circuit: a tech-store layout package (doc 27 T-D).
 * Dark-navy header tier (logo, wide white search, Offers/Account
 * links, one blue→cyan gradient CTA) over a white category bar,
 * floating dark cart/compare edge buttons, spacious white product
 * cards with a purple savings pill (real compare-at amounts only)
 * and red prices, a dark-navy footer and a slide-in cart drawer.
 * Palette is a designed system (navy, orange primary, price red)
 * — hence lockPalette. This package authors a REAL dark token
 * delta (deep-navy surfaces), hence supportsDark: true. Every
 * option below is consumed by the package's components
 * (showUtilityCards by the home utility island, showFloatingActions
 * by the header's floating edge buttons).
 */
export const CIRCUIT_PACKAGE: ThemePackage = {
  id: "circuit",
  name: "Circuit",
  nameBn: "সার্কিট",
  version: "1.0.0",
  author: "Advance Commerce",
  description:
    "A tech-store layout — dark-navy header with a gradient CTA and white category bar, floating cart/compare buttons, spacious cards with a purple savings pill and red prices, dark footer, cart drawer. Best for electronics, gadgets and computer stores.",
  preview: ["#F07D1A", "#10222E", "#EFF3F6"],
  lockPalette: true,
  supportsDark: true,
  optionsSchema: [
    {
      key: "showUtilityCards",
      type: "boolean",
      label: "Show utility cards on home",
      labelBn: "হোমে সুবিধা কার্ড দেখান",
      default: true,
    },
    {
      key: "showFloatingActions",
      type: "boolean",
      label: "Floating cart/compare buttons",
      labelBn: "ভাসমান কার্ট/তুলনা বাটন",
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
  [CIRCUIT_PACKAGE.id, CIRCUIT_PACKAGE],
]);
```

---

## 2. `src/themes/slot-registry.tsx` — server slot map

Add the import (after the bazaar import):

```ts
import { CIRCUIT_SLOTS } from "./circuit/slots";
```

Add the map entry inside `PACKAGE_SLOTS`:

```ts
const PACKAGE_SLOTS: ReadonlyMap<string, Partial<ThemeSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SLOTS],
  ["bazaar", BAZAAR_SLOTS],
  ["circuit", CIRCUIT_SLOTS],
]);
```

---

## 3. `src/themes/client-slot-registry.tsx` — shell slots + cart drawer

Add the imports (after the bazaar imports):

```ts
import { CIRCUIT_SHELL_SLOTS } from "./circuit/shell-slots";
import CircuitCartDrawer from "./circuit/cart-drawer";
```

Add the entry inside `PACKAGE_SHELL_SLOTS`:

```ts
const PACKAGE_SHELL_SLOTS: ReadonlyMap<string, Partial<ThemeShellSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SHELL_SLOTS],
  ["bazaar", BAZAAR_SHELL_SLOTS],
  ["circuit", CIRCUIT_SHELL_SLOTS],
]);
```

Add the entry inside `PACKAGE_CART_DRAWERS`:

```ts
const PACKAGE_CART_DRAWERS: ReadonlyMap<string, ThemeCartDrawerSlot> = new Map<string, ThemeCartDrawerSlot>([
  [DEFAULT_PACKAGE_ID, NullCartDrawer],
  ["bazaar", BazaarCartDrawer],
  ["circuit", CircuitCartDrawer],
]);
```

---

## 4. `src/themes/client-card-registry.tsx` — ProductCard

Add the import (after the bazaar import):

```ts
import { CircuitProductCard } from "./circuit/product-card";
```

Add the entry inside `PACKAGE_PRODUCT_CARDS`:

```ts
const PACKAGE_PRODUCT_CARDS: ReadonlyMap<string, ThemeProductCardSlot> = new Map([
  [DEFAULT_PACKAGE_ID, ProductCard],
  ["bazaar", BazaarProductCard],
  ["circuit", CircuitProductCard],
]);
```

---

## 5. `src/themes/client-shop-registry.tsx` — ShopChrome

Add the import (after the bazaar import):

```ts
import CircuitShopChrome from "./circuit/shop-chrome";
```

Add the entry inside `PACKAGE_SHOP_CHROME`:

```ts
const PACKAGE_SHOP_CHROME: ReadonlyMap<string, ThemeShopChromeSlot> = new Map([
  [DEFAULT_PACKAGE_ID, AuroraShopChrome],
  ["bazaar", BazaarShopChrome],
  ["circuit", CircuitShopChrome],
]);
```

---

## 6. `src/themes/skin-registry.ts` — checkout skin

Add the import (after the bazaar import):

```ts
import { CIRCUIT_CHECKOUT_SKIN } from "./circuit/checkout-skin";
```

Add the entry inside `PACKAGE_SKINS`:

```ts
const PACKAGE_SKINS: ReadonlyMap<string, Partial<CheckoutSkin>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_CHECKOUT_SKIN],
  ["bazaar", BAZAAR_CHECKOUT_SKIN],
  ["circuit", CIRCUIT_CHECKOUT_SKIN],
]);
```

---

## Notes for integration

- No new dependencies, no schema/migration changes, no new
  routes. Instance creation: POST a theme with `packageId:
  "circuit"` and `tokens: CIRCUIT_TOKENS` (same flow as bazaar).
- Options consumed: `showUtilityCards` (home-utility.tsx island),
  `showFloatingActions` (header.tsx floating edge buttons).
- The header's floating compare button links to the platform's
  real `/compare` route (verified: `app/(store)/compare` exists).
  It carries NO count badge — the compare tray's count is not part
  of ThemeHeaderProps, and no count is invented.
- Header "Offers" link and the gradient CTA both point to `/shop`:
  the platform has no separate offers route, and no dead link is
  shipped. If an offers landing route is ever added, retarget both
  there.
- Dark mode: the manifest declares `supportsDark: true` and
  `CIRCUIT_TOKENS.dark` is a full authored delta (deep-navy
  surfaces, brightened price red) — not a passthrough.
- PDP WhatsApp/Call buttons: the composition passes no numbers
  (no public store number exists), so they are omitted, exactly
  as in bazaar. The seam is `CircuitPdpBuySectionProps.whatsappNumber`
  / `callNumber`.
