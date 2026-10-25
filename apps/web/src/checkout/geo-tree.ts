/**
 * Geo cascade tree — client-safe types + lookups (doc 17 batch O2).
 *
 * The DATA comes from GET /api/v1/public/geo, which serves the tree
 * built server-side from the canonical BD geo dataset
 * (packages/db/prisma/data/bd-geo.json via src/bd/geo-dictionary.ts,
 * so curated Dhaka city areas ride along as upazila-level entries).
 * This module holds only the shape and pure lookups over a fetched
 * tree — importing it never pulls the ~700 KB dataset into a bundle.
 *
 * Values stored on orders are the canonical nameEn strings; nameBn is
 * display-only (the Bangla-first storefront labels its selects with
 * nameBn).
 */

export interface GeoTreeUpazila {
  nameEn: string;
  nameBn: string;
  /** Dhaka city thana/areas (Mirpur, Uttara…) ride as upazila-level picks. */
  isArea?: boolean;
}

export interface GeoTreeDistrict {
  nameEn: string;
  nameBn: string;
  upazilas: GeoTreeUpazila[];
}

export interface GeoTreeDivision {
  nameEn: string;
  nameBn: string;
  districts: GeoTreeDistrict[];
}

export type GeoTree = GeoTreeDivision[];

export function districtsOf(tree: GeoTree, divisionEn: string): GeoTreeDistrict[] {
  return tree.find((d) => d.nameEn === divisionEn)?.districts ?? [];
}

export function upazilasOf(
  tree: GeoTree,
  divisionEn: string,
  districtEn: string,
): GeoTreeUpazila[] {
  return districtsOf(tree, divisionEn).find((d) => d.nameEn === districtEn)?.upazilas ?? [];
}

/** Locate a district anywhere in the tree (parser suggestions carry
 *  a district first; its division follows from the tree). */
export function findDistrict(
  tree: GeoTree,
  districtEn: string,
): { division: GeoTreeDivision; district: GeoTreeDistrict } | null {
  for (const division of tree) {
    const district = division.districts.find((d) => d.nameEn === districtEn);
    if (district) return { division, district };
  }
  return null;
}
