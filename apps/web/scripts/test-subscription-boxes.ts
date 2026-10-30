/**
 * Subscription Boxes unit test suite — run via `pnpm --filter web tsx scripts/test-subscription-boxes.ts`
 * Tests pure logic: cycle key calculations, note building, config validation, discount resolution.
 */
import assert from "node:assert/strict";
import {
  isValidCycleKey,
  cycleKindOfKey,
  cycleKindOfInterval,
  isoWeekKeyOfYmd,
  cycleKeyForInterval,
  boxCycleKeyFromNoteText,
} from "../src/boxes/cycles";
import {
  boxesConfigSchema,
  effectiveBoxDiscountBps,
  DEFAULT_BOXES_CONFIG,
  type BoxesConfig,
} from "../src/boxes/config";
import { buildBoxNoteText, boxContentsMissingError } from "../src/boxes/generate";
import type { BoxCycleContents } from "../src/boxes/contents";

async function runTests() {
  console.log("🧪 Running Subscription Boxes Unit Test Suite...\n");
  let passed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // 1. Cycle Keys & Dhaka Interval mappings
  test("isValidCycleKey validates monthly and ISO weekly keys", () => {
    assert.equal(isValidCycleKey("2026-11"), true);
    assert.equal(isValidCycleKey("2026-01"), true);
    assert.equal(isValidCycleKey("2026-12"), true);
    assert.equal(isValidCycleKey("2026-W01"), true);
    assert.equal(isValidCycleKey("2026-W48"), true);
    assert.equal(isValidCycleKey("2026-W53"), true);

    // Invalid keys
    assert.equal(isValidCycleKey("2026-13"), false);
    assert.equal(isValidCycleKey("2026-00"), false);
    assert.equal(isValidCycleKey("2026-W00"), false);
    assert.equal(isValidCycleKey("2026-W54"), false);
    assert.equal(isValidCycleKey("invalid"), false);
    assert.equal(isValidCycleKey("2026-W4"), false);
  });

  test("cycleKindOfKey identifies cycle kinds", () => {
    assert.equal(cycleKindOfKey("2026-11"), "monthly");
    assert.equal(cycleKindOfKey("2026-W48"), "weekly");
    assert.equal(cycleKindOfKey("not-a-key"), null);
  });

  test("cycleKindOfInterval maps intervals correctly", () => {
    assert.equal(cycleKindOfInterval("MONTHLY"), "monthly");
    assert.equal(cycleKindOfInterval("WEEKLY"), "weekly");
    assert.equal(cycleKindOfInterval("BIWEEKLY"), "weekly");
    assert.equal(cycleKindOfInterval("CUSTOM"), "monthly"); // fallback
  });

  test("isoWeekKeyOfYmd calculates standard ISO week keys", () => {
    // 2026-10-31 is Saturday in ISO week 44 of 2026
    const week = isoWeekKeyOfYmd("2026-10-31");
    assert.match(week, /^2026-W44$/);
  });

  test("cycleKeyForInterval derives cycle from scheduled date", () => {
    const nov1 = new Date(Date.UTC(2026, 10, 1, 6, 0, 0)); // 2026-11-01 in Dhaka
    assert.equal(cycleKeyForInterval("MONTHLY", nov1), "2026-11");
  });

  test("boxCycleKeyFromNoteText extracts marker from order internalNote", () => {
    const text = "সাবস্ক্রিপশন বক্স — সাইকেল 2026-11 [box:2026-11]\nপ্রতি বাক্সে: মধু (HONEY-1) × 1";
    assert.equal(boxCycleKeyFromNoteText(text), "2026-11");

    const weeklyText = "সাবস্ক্রিপশন অর্ডার [box:2026-W48]";
    assert.equal(boxCycleKeyFromNoteText(weeklyText), "2026-W48");

    const noMarker = "সাধারণ অর্ডার";
    assert.equal(boxCycleKeyFromNoteText(noMarker), null);
  });

  // 2. Config & Discount Resolution
  test("boxesConfigSchema validates and cleans config", () => {
    const valid = {
      boxVariantIds: ["var-1", "var-2", "var-1"], // duplicate will be de-duplicated by clean()
      cycles: ["monthly", "weekly"],
      discountBps: 1000,
    };
    const parsed = boxesConfigSchema.parse(valid);
    assert.equal(parsed.discountBps, 1000);
    assert.deepEqual(parsed.cycles, ["monthly", "weekly"]);
  });

  test("effectiveBoxDiscountBps overrides global when positive", () => {
    const configWithDiscount: BoxesConfig = {
      boxVariantIds: ["var-1"],
      cycles: ["monthly"],
      discountBps: 800, // 8%
    };
    // Positive box discount overrides 5% (500) global discount
    assert.equal(effectiveBoxDiscountBps(configWithDiscount, 500), 800);

    const configWithZeroDiscount: BoxesConfig = {
      ...DEFAULT_BOXES_CONFIG,
      discountBps: 0,
    };
    // 0 box discount falls back to global discount
    assert.equal(effectiveBoxDiscountBps(configWithZeroDiscount, 500), 500);
  });

  test("boxesConfigSchema rejects discounts exceeding 5000 basis points (50%)", () => {
    assert.throws(() => {
      boxesConfigSchema.parse({
        boxVariantIds: ["var-1"],
        cycles: ["monthly"],
        discountBps: 5500, // exceeds 5000 bps
      });
    });
  });

  // 3. Order Note Formatting & Budget Clamping
  test("buildBoxNoteText creates structured internal note with marker", () => {
    const cycle: BoxCycleContents = {
      cycleKey: "2026-11",
      noteBn: "শীতকালীন স্পেশাল বক্স",
      noteEn: "Winter Special",
      items: [
        {
          variantId: "v-1",
          productName: "সুন্দরবনের মধু",
          sku: "HONEY-500",
          variantLabel: "৫০০ গ্রাম",
          quantity: 1,
        },
        {
          variantId: "v-2",
          productName: "ঘি",
          sku: "GHEE-250",
          variantLabel: "২৫০ গ্রাম",
          quantity: 2,
        },
      ],
    };

    const note = buildBoxNoteText(cycle);
    assert.ok(note.includes("[box:2026-11]"), "Must include box cycle marker");
    assert.ok(note.includes("শীতকালীন স্পেশাল বক্স"), "Must include Bengali theme note");
    assert.ok(note.includes("HONEY-500"), "Must include item SKU");
    assert.ok(note.length <= 380, `Note must be within 380 chars budget, was ${note.length}`);
  });

  test("boxContentsMissingError creates bilingual descriptive error", () => {
    const err = boxContentsMissingError("2026-11");
    assert.ok(err.startsWith("BOX_CONTENTS_MISSING:"));
    assert.ok(err.includes("2026-11"));
    assert.ok(err.includes("skipped"));
  });

  console.log(`\n🎉 Summary: ${passed} / 9 tests passed successfully!\n`);
}

void runTests();
