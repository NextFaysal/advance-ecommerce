# BD geo dataset — provenance & validation

`bd-geo.json` is the full Bangladesh Division > District > Upazila > Union
dataset used by `../seed.ts` (`loadGeoData()`) and by the web app's address
parser (`apps/web/src/bd/geo-dictionary.ts`). It replaced the previous
2-division SAMPLE file on 2026-10-24. `bd-geo-full-DRAFT.json` in this
folder is the earlier unverified draft — **superseded** by `bd-geo.json`;
kept only as a historical artefact.

## Source

- Package: `bd-divisions-to-unions@1.0.4` (npm), author Azim Uddin Ahamed
- Fetched: 2026-10-24, via jsDelivr CDN (no package was installed):
  - `https://cdn.jsdelivr.net/npm/bd-divisions-to-unions@1.0.4/@response-from-this-folder/bangla.js`
  - `https://cdn.jsdelivr.net/npm/bd-divisions-to-unions@1.0.4/@response-from-this-folder/english.js`
  - `https://cdn.jsdelivr.net/npm/bd-divisions-to-unions@1.0.4/package.json` / `LICENSE`
- Upstream repo: https://github.com/Azim-Ahmed/bd-divisons-to-unions
- License: **ISC** (see text below). The data is organised by BBS geo codes
  (division / district / upazila `code` fields are the BBS codes; union
  codes are the source package's own ids).

## Validation performed (2026-10-24, before wiring)

Counts — divisions **8**, districts **64**, upazilas **504**, unions
**4,964** (matches the draft's claims and the expected national totals).

- **Referential integrity:** every district key belongs to a known
  division, every upazila key to a known district, every union key to a
  known upazila — 0 orphans. No duplicate codes at any level.
- **bn/en completeness:** every row has a non-empty Bangla and English
  name — 0 missing. ⚠️ The source's bn and en lists are **ordered
  differently and must be merged by code, never by array index** (e.g.
  Dhaka district's upazilas start with Keraniganj in bn but Savar in en).
- **Spot checks (all pass):** Savar → Dhaka district → Dhaka division;
  Hathazari → Chattogram district → Chattogram division; Cox's Bazar
  district → Chattogram division; Sylhet district → Sylhet division;
  Khulna district → Khulna division; Dhaka district → Dhaka division.
- **Cross-check vs the DRAFT:** districts 64/64 with identical bn names
  and division assignments (the only nameEn diff is the intentional
  Comilla → Cumilla rename below, applied after the cross-check);
  upazilas 504/504 (only diffs: leading-space artefacts in the DRAFT,
  e.g. `" Rajshahi City Corporation"`); unions 4,954 unique names with
  identical multiplicities (diffs again only the DRAFT's whitespace
  artefacts). Conclusion: the DRAFT was derived from this same source;
  this file supersedes it with trimmed, validated data.

## Normalizations applied during conversion

1. English names merged by BBS code; whitespace trimmed; English
   title-cased (the source mixes cases, e.g. `"rangpur sadar"`).
2. `Chattagram → Chattogram`, `Barisal → Barishal` (division + district),
   `Comilla → Cumilla` (district), `Coxsbazar → Cox's Bazar`,
   `Coxsbazar Sadar → Cox's Bazar Sadar` — official 2018 renames / BBS
   spelling, matching the codebase's canonical names (address parser
   dictionary).
3. Bangla names normalized to **Unicode NFC**: upstream mixes composed
   (য় U+09DF) and decomposed (য U+09AF + ় U+09BC) nukta forms, which
   look identical but fail string matching. NFC yields one canonical
   form; the address parser NFC-normalizes its input the same way.
4. 10 union `nameEn` collisions within one upazila were disambiguated
   from the Bangla name: 9 are municipalities (পৌরসভা → `" Municipality"`
   suffix; the rule touched 98 municipality unions in total, most of
   which had no collision) and Natai (দক্ষিন)/(উত্তর) → `"(South)"` /
   `"(North)"` (4 directional suffixes). No rows were dropped.

## Known issues (in the source itself — not hidden)

- **Shayestaganj** upazila (Habiganj, code 504) has **0 unions** in the
  source. Kept as an empty list; do not invent unions for it.
- **Bhuapur Municipality** (Bhuapur, Tangail) appears twice upstream
  (codes 4543 & 4736, near-identical Bangla spellings) — apparently the
  same municipality listed twice. Both rows are kept for fidelity; the
  seed upserts unions by (nameEn, upazila), so it is stored once. Also
  recorded in `bd-geo.json._knownIssues`.
- City-corporation entries (e.g. "Dhaka North City Corporation") appear
  as upazila-level rows in the source; kept as-is.

## License (ISC)

```
ISC License

Copyright (c) 2024 Azim Uddin Ahamed

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM THE USE OF THIS SOFTWARE.
```
