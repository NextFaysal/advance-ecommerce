import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { customFieldDefinitionSchema, type CustomFieldDefinition } from "@/extensibility/types";
import {
  CUSTOM_FIELD_DEFINITIONS_CAP,
  isWiredCustomFieldEntity,
  loadCustomFieldDefinitions,
  saveCustomFieldDefinitions,
} from "@/extensibility/custom-fields-store";
import { validationError } from "@/webhooks/admin-http";
import { recordDemoAudit } from "../audit-log/store";

// Custom-field definitions — admin (ADV-26 wiring, doc 23 wave 53).
// Guard: settings.integrations (same as the partner API keys next
// door — definitions are part of the developer-platform surface).
// Storage: the custom_fields.definitions Setting doc via
// src/extensibility/custom-fields-store (the engine ships no store).
// PUT is a whole-list replace, reason-required + audited, following
// the house convention for machine-shaped docs. Only the wired
// entities (product / customer / order) are accepted — the engine's
// "variant" entity has no admin surface yet, so defining fields for
// it is refused rather than silently unusable.
export async function GET() {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const definitions = await loadCustomFieldDefinitions();
  return NextResponse.json({
    data: { definitions },
    meta: {
      persistence: "setting-doc",
      note: "Definitions are merchant configuration; values are stored per entity in custom_fields.values.<entity> docs and validated by the extensibility engine on every write.",
    },
  });
}

const putSchema = z.object({
  definitions: z.array(z.unknown()).max(CUSTOM_FIELD_DEFINITIONS_CAP + 1),
  reason: z.string().trim().min(1).max(500),
});

export async function PUT(req: Request) {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  if (parsed.data.definitions.length > CUSTOM_FIELD_DEFINITIONS_CAP) {
    return validationError([`definitions: at most ${CUSTOM_FIELD_DEFINITIONS_CAP} definitions in total.`]);
  }

  // Validate every definition against the ENGINE's schema, then the
  // cross-definition rules the schema alone cannot express.
  const problems: string[] = [];
  const definitions: CustomFieldDefinition[] = [];
  const seen = new Set<string>();
  parsed.data.definitions.forEach((raw, index) => {
    const result = customFieldDefinitionSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        problems.push(`definitions.${index}.${issue.path.join(".")}: ${issue.message}`);
      }
      return;
    }
    const def = result.data;
    if (!isWiredCustomFieldEntity(def.entity)) {
      problems.push(`definitions.${index}.entity: "${def.entity}" fields are not wired yet (product / customer / order only).`);
      return;
    }
    const identity = `${def.entity}:${def.key}`;
    if (seen.has(identity)) {
      problems.push(`definitions.${index}.key: duplicate key "${def.key}" for entity "${def.entity}".`);
      return;
    }
    seen.add(identity);
    if ((def.type === "select" || def.type === "multiselect") && (!def.options || def.options.length === 0)) {
      problems.push(`definitions.${index}.options: ${def.type} fields need at least one option.`);
      return;
    }
    definitions.push(def);
  });
  if (problems.length > 0) return validationError(problems);

  const before = await loadCustomFieldDefinitions();
  await saveCustomFieldDefinitions(definitions, guard.userId);
  await recordDemoAudit({
    actorId: guard.userId,
    action: "custom_fields.definitions.update",
    entityType: "Setting",
    entityId: "custom_fields.definitions",
    reason: parsed.data.reason,
    beforeJson: { definitions: before },
    afterJson: { definitions },
  });
  return NextResponse.json({
    data: { definitions },
    meta: { persistence: "setting-doc" },
  });
}
