/**
 * Review / message classifier — Agent 15, Step 47 (A3).
 * KEYWORD FALLBACK ONLY: sentiment and spam verdicts come from the word
 * lists below. This is not ML — sarcasm, mixed Bangla-English nuance and
 * new spam phrasing will be missed. Verdicts are decision SUPPORT for
 * staff (matched keywords are returned so a human can see why); never
 * auto-delete a review/message on a "spam" verdict alone.
 *
 * Test cases:
 *  "খুব ভালো প্রোডাক্ট, ধন্যবাদ" -> sentiment positive (ভালো)
 *  "Very bad quality, totally disappointed" -> sentiment negative
 *  "WINNER!! claim your prize, click http://x.example, free money" -> spam
 *  "Delivery was on time" -> neutral sentiment (time is not a keyword), ham
 */
import type { ClassifyResult, Sentiment, SpamVerdict } from "./types";
import { TEMPLATE_META } from "./types";

const POSITIVE = ["ভালো", "চমৎকার", "সুন্দর", "ধন্যবাদ", "খুশি", "সেরা", "good", "great", "excellent", "love", "happy", "best", "perfect", "recommend"];
const NEGATIVE = ["খারাপ", "বাজে", "নকল", "দেরি", "হতাশ", "bad", "worst", "fake", "disappointed", "broken", "poor", "terrible", "late delivery", "scam"];
const SPAM = ["winner", "prize", "free money", "click here", "earn money", "lottery", "casino", "crypto giveaway", "whatsapp me", "loan approved", "বিনামূল্যে টাকা", "লটারি"];

function findHits(text: string, words: string[]): string[] {
  const lower = text.toLowerCase();
  return words.filter((w) => lower.includes(w.toLowerCase()));
}

export function classifyText(rawText: string): ClassifyResult {
  const text = rawText.slice(0, 5000);
  const pos = findHits(text, POSITIVE);
  const neg = findHits(text, NEGATIVE);
  const spamHits = findHits(text, SPAM);
  const linkCount = (text.match(/https?:\/\//gi) ?? []).length;

  const sentiment: Sentiment = pos.length > neg.length ? "positive" : neg.length > pos.length ? "negative" : "neutral";
  let spam: SpamVerdict = "ham";
  if (spamHits.length >= 2 || (spamHits.length >= 1 && linkCount >= 1)) spam = "spam";
  else if (spamHits.length === 1 || linkCount >= 2) spam = "suspect";

  return { sentiment, spam, matchedKeywords: [...pos, ...neg, ...spamHits], meta: TEMPLATE_META };
}
