/**
 * Preset starter themes for quick 1-click loading in the theme creator.
 */
import { generateSmartPalette } from "./theme-palette-generator";
import type { ThemeTokens } from "./themes";

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  primaryHex: string;
  preview: string[];
  tokens: ThemeTokens;
}

const PRESET_DEFINITIONS = [
  {
    id: "ocean-breeze",
    name: "Ocean Breeze",
    description: "শান্ত নীল ও সিয়ান রঙের আরামদায়ক কম্বিনেশন",
    primaryHex: "#0284c7",
  },
  {
    id: "emerald-forest",
    name: "Emerald Forest",
    description: "সবুজ ও প্রকৃতির সতেজ আবহে তৈরি থিম",
    primaryHex: "#059669",
  },
  {
    id: "sunset-crimson",
    name: "Sunset Crimson",
    description: "গোলাপি ও সানসেট অরেঞ্জের প্রিমিয়াম লুক",
    primaryHex: "#e11d48",
  },
  {
    id: "royal-amethyst",
    name: "Royal Amethyst",
    description: "গাঢ় বেগুনি ও ভায়োলেট রঙের লাক্সারি ভাইব",
    primaryHex: "#7c3aed",
  },
  {
    id: "amber-gold",
    name: "Amber Gold",
    description: "উজ্জ্বল গোল্ড ও অ্যাম্বার রঙের এনার্জেটিক থিম",
    primaryHex: "#d97706",
  },
  {
    id: "cyber-midnight",
    name: "Cyber Midnight",
    description: "ডার্ক ও নিয়ন সায়ানের আধুনিক টেক লুক",
    primaryHex: "#06b6d4",
  },
];

export const THEME_PRESETS: ThemePreset[] = PRESET_DEFINITIONS.map((def) => {
  const { tokens, preview } = generateSmartPalette(def.primaryHex);
  return {
    ...def,
    preview,
    tokens,
  };
});
