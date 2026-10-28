/**
 * Size-guide modal data — Part B. Reuses the fashion pack's chart logic
 * (src/business-modules/fashion.ts: buildSizeGuide + FASHION_DEFAULT_CONFIG)
 * and only adds the bilingual labels + guide copy the modal renders.
 */
import { buildSizeGuide, FASHION_DEFAULT_CONFIG, type FashionConfig } from "@/business-modules/fashion";

export interface SizeGuideModalData {
  titleBn: string;
  titleEn: string;
  showMeasureGuide: boolean;
  /** "কীভাবে মাপবেন" lines, shown only when showMeasureGuide is true. */
  measureGuideBn: string[];
  /** "How to measure" lines — the en counterpart of measureGuideBn. */
  measureGuideEn: string[];
  rows: Array<{
    size: string;
    measurements: Array<{ labelBn: string; labelEn: string; cm: number }>;
  }>;
}

const MEASUREMENT_LABELS: Record<string, { bn: string; en: string }> = {
  chest: { bn: "বুক", en: "Chest" },
  waist: { bn: "কোমর", en: "Waist" },
  length: { bn: "লম্বা", en: "Length" },
  foot: { bn: "পা", en: "Foot" },
};

const MEASURE_GUIDE_BN: string[] = [
  "বুক: বগলের নিচ দিয়ে বুকের সবচেয়ে চওড়া অংশ মাপুন।",
  "কোমর: স্বাভাবিক কোমরলাইন বরাবর মাপুন, টেপ ঢিলা রাখুন।",
  "লম্বা: কাঁধের সবচেয়ে উঁচু জায়গা থেকে নিচ পর্যন্ত মাপুন।",
  "দুই মাপের মাঝে পড়লে বড় সাইজটি নেওয়াই ভালো।",
];

const MEASURE_GUIDE_EN: string[] = [
  "Chest: measure around the widest part of your chest, under the arms.",
  "Waist: measure around your natural waistline, keeping the tape loose.",
  "Length: measure from the highest point of the shoulder down.",
  "If you're between two sizes, take the larger one.",
];

export function buildSizeGuideModalData(config: FashionConfig = FASHION_DEFAULT_CONFIG): SizeGuideModalData {
  return {
    titleBn: "সাইজ গাইড",
    titleEn: "Size Guide",
    showMeasureGuide: config.showMeasureGuide,
    measureGuideBn: config.showMeasureGuide ? MEASURE_GUIDE_BN : [],
    measureGuideEn: config.showMeasureGuide ? MEASURE_GUIDE_EN : [],
    rows: buildSizeGuide(config).map((r) => ({
      size: r.size,
      measurements: r.measurements.map((m) => ({
        labelBn: MEASUREMENT_LABELS[m.label]?.bn ?? m.label,
        labelEn: MEASUREMENT_LABELS[m.label]?.en ?? m.label,
        cm: m.cm,
      })),
    })),
  };
}
