/**
 * Full BD geo dictionary for the address parser — Agent 68 (2026-10-24).
 *
 * Builds a GeoDictionary from the SAME validated dataset the DB seed uses
 * (packages/db/prisma/data/bd-geo.json — bd-divisions-to-unions@1.0.4,
 * ISC; 8 divisions / 64 districts / 504 upazilas; provenance + validation
 * in packages/db/prisma/data/README.md), merged with the curated
 * DEFAULT_GEO_DICTIONARY from address-parser.ts:
 *
 *  - Dataset entries provide the breadth (every district + upazila, bn +
 *    en). Aliases start as the lowercase English name; curated aliases
 *    for the same nameEn (e.g. "chittagong", "comilla", "bogra") are
 *    unioned in.
 *  - Curated UPAZILA entries take precedence on a nameEn collision and
 *    are placed first: the curated set carries Dhaka city AREAS
 *    (Mirpur, Uttara, Dhanmondi... marked isArea) which must win over
 *    same-named rural upazilas (e.g. Mirpur, Kushtia) for the common
 *    Dhaka-address case. Same-named dataset upazilas shadowed this way
 *    are still reachable when their district is named and matched via
 *    the district path — but note parseAddress() is first-match, so a
 *    bare ambiguous upazila name resolves to the curated entry. This is
 *    a deliberate trade-off, documented here, not an accident.
 *  - 9 upazila names exist in more than one district in the real data
 *    (Kaliganj x4, Companiganj x2, ...). First match wins; when the text
 *    also names a district, the district match is independent and the
 *    result should be staff-confirmed at low confidence as designed.
 *
 * The curated DEFAULT_GEO_DICTIONARY remains the fallback
 * (parseAddress's default) so existing consumers keep their exact
 * behaviour unless they opt into FULL_GEO_DICTIONARY.
 *
 * Bundle note: importing this module pulls the ~700 KB dataset JSON
 * into the bundle. Prefer server-side use, or opt-in surfaces like the
 * admin bd-tools panel, over hot storefront paths.
 */
import geoDataset from "../../../../packages/db/prisma/data/bd-geo.json";
import {
  DEFAULT_GEO_DICTIONARY,
  type GeoDictionary,
  type GeoDistrict,
  type GeoDivision,
  type GeoUpazila,
} from "./address-parser";

interface GeoDatasetShape {
  divisions: Array<{
    division: { nameEn: string; nameBn: string; code?: string };
    districts: Array<{
      nameEn: string;
      nameBn: string;
      code?: string;
      upazilas: Array<{ nameEn: string; nameBn: string; code?: string }>;
    }>;
  }>;
}

const data = geoDataset as unknown as GeoDatasetShape;

/**
 * Extra aliases for dataset spellings that differ from the spelling
 * customers actually type (the parser's typo pass would catch these at
 * a -0.1 confidence penalty; an exact alias is better). Keyed by the
 * dataset nameEn.
 */
const EXTRA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Source spells it "Shayestagonj"; the common/BBS spelling is Shayestaganj.
  Shayestagonj: ["shayestaganj"],
};

function mergeAliases(nameEn: string, curated: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  const add = (alias: string) => {
    const a = alias.toLowerCase();
    out.add(a);
    // The parser strips apostrophes when tokenising input, so an alias
    // like "cox's bazar" can never match the token stream "cox s bazar".
    // Add the token-stream variants alongside the canonical alias.
    if (a.includes("'")) {
      out.add(a.replace(/'/g, " "));
      out.add(a.replace(/'/g, ""));
    }
  };
  add(nameEn);
  for (const a of curated ?? []) add(a);
  for (const a of EXTRA_ALIASES[nameEn] ?? []) add(a);
  return [...out];
}

/** Bangla names are matched by substring — keep them in the same NFC
 *  form the parser normalizes input to (see parseAddress). */
function bn(nameBn: string): string {
  return nameBn.normalize("NFC");
}

function buildFullGeoDictionary(): GeoDictionary {
  const curatedDivisionByName = new Map(DEFAULT_GEO_DICTIONARY.divisions.map((d) => [d.nameEn, d]));
  const curatedDistrictByName = new Map(DEFAULT_GEO_DICTIONARY.districts.map((d) => [d.nameEn, d]));
  const curatedUpazilaByName = new Map(DEFAULT_GEO_DICTIONARY.upazilas.map((u) => [u.nameEn, u]));

  const divisions: GeoDivision[] = [];
  const districts: GeoDistrict[] = [];
  const datasetUpazilas: GeoUpazila[] = [];

  for (const row of data.divisions) {
    const divisionEn = row.division.nameEn;
    divisions.push({
      nameEn: divisionEn,
      nameBn: bn(row.division.nameBn),
      aliases: mergeAliases(divisionEn, curatedDivisionByName.get(divisionEn)?.aliases),
    });
    for (const dist of row.districts) {
      districts.push({
        nameEn: dist.nameEn,
        nameBn: bn(dist.nameBn),
        divisionEn,
        aliases: mergeAliases(dist.nameEn, curatedDistrictByName.get(dist.nameEn)?.aliases),
      });
      for (const up of dist.upazilas) {
        if (curatedUpazilaByName.has(up.nameEn)) continue; // curated wins (see header)
        datasetUpazilas.push({
          nameEn: up.nameEn,
          nameBn: bn(up.nameBn),
          districtEn: dist.nameEn,
          aliases: mergeAliases(up.nameEn, undefined),
        });
      }
    }
  }

  // Curated divisions/districts missing from the dataset (none expected
  // since the Comilla -> Cumilla rename was applied to the dataset) are
  // appended so nothing the curated dictionary knew is ever lost.
  for (const d of DEFAULT_GEO_DICTIONARY.divisions) {
    if (!divisions.some((x) => x.nameEn === d.nameEn)) divisions.push({ ...d, nameBn: bn(d.nameBn) });
  }
  for (const d of DEFAULT_GEO_DICTIONARY.districts) {
    if (!districts.some((x) => x.nameEn === d.nameEn)) districts.push({ ...d, nameBn: bn(d.nameBn) });
  }

  return {
    divisions,
    districts,
    // Curated upazilas first (precedence on collisions), then the full
    // dataset breadth.
    upazilas: [
      ...DEFAULT_GEO_DICTIONARY.upazilas.map((u) => ({ ...u, nameBn: bn(u.nameBn) })),
      ...datasetUpazilas,
    ],
  };
}

export const FULL_GEO_DICTIONARY: GeoDictionary = buildFullGeoDictionary();
