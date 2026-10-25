import { NextResponse } from "next/server";
import { FULL_GEO_DICTIONARY } from "@/bd/geo-dictionary";
import type { GeoTree } from "@/checkout/geo-tree";

// GET /api/v1/public/geo — the Division › District › Upazila cascade
// tree for the checkout address form (doc 17 batch O2).
//
// Built once at module load from the canonical BD geo dataset
// (packages/db/prisma/data/bd-geo.json, merged with the curated
// dictionary: 8 divisions / 64 districts / 504 dataset upazilas plus
// curated Dhaka city areas as upazila-level picks). Values are the
// canonical nameEn strings orders store; nameBn is the display label.
//
// The dataset is static per deployment, so unlike the live-data
// public routes this one is cacheable: no force-dynamic, and an
// explicit day-long Cache-Control for browsers/CDN.
const GEO_TREE: GeoTree = FULL_GEO_DICTIONARY.divisions.map((division) => ({
  nameEn: division.nameEn,
  nameBn: division.nameBn,
  districts: FULL_GEO_DICTIONARY.districts
    .filter((d) => d.divisionEn === division.nameEn)
    .map((district) => ({
      nameEn: district.nameEn,
      nameBn: district.nameBn,
      upazilas: FULL_GEO_DICTIONARY.upazilas
        .filter((u) => u.districtEn === district.nameEn)
        .map((u) => ({
          nameEn: u.nameEn,
          nameBn: u.nameBn,
          ...(u.isArea ? { isArea: true } : {}),
        })),
    })),
}));

export async function GET() {
  return NextResponse.json(
    { data: GEO_TREE },
    {
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    },
  );
}
