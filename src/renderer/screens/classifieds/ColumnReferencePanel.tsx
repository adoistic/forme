import React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretDown } from "@phosphor-icons/react";
import { FieldSchemaByType, type ClassifiedType } from "@shared/schemas/classified.js";
import type { z } from "zod";

// "What columns do I need?" — a collapsible per-type schema browser used
// next to the import controls (T16). The columns are derived directly
// from the Zod schemas in src/shared/schemas/classified.ts so the panel
// can never drift out of sync. Each type renders as a <details>-style
// disclosure with one row per field showing name + required/optional +
// short hint.

interface FieldDescriptor {
  name: string;
  required: boolean;
  hint: string;
}

/**
 * Walk a Zod object schema and produce a flat field list. Handles the
 * shapes used in classified.ts: `z.object`, `.extend`, and `.omit` —
 * all expose a `.shape` accessor on the resolved schema.
 */
function describeSchema(schema: z.ZodTypeAny): FieldDescriptor[] {
  // ZodObject in v3+ exposes `.shape` either as a plain object or a getter.
  const shape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
  if (!shape || typeof shape !== "object") return [];
  return Object.entries(shape).map(([name, def]) => {
    return {
      name,
      required: !isOptional(def),
      hint: hintFor(def),
    };
  });
}

function isOptional(def: z.ZodTypeAny): boolean {
  // Zod v3+: optional/default/nullable wrap with a `_def.typeName` discriminator
  // OR (v4) a `def.type` discriminator. We just inspect both.
  const inner =
    (def as unknown as { _def?: { typeName?: string }; def?: { type?: string } }) ?? {};
  const typeName = inner._def?.typeName ?? inner.def?.type;
  if (typeName === "ZodOptional" || typeName === "optional") return true;
  if (typeName === "ZodDefault" || typeName === "default") return true;
  if (typeName === "ZodNullable" || typeName === "nullable") return true;
  // Sometimes nested under .innerType — recurse one level
  const innerType = (def as unknown as { _def?: { innerType?: z.ZodTypeAny } })._def?.innerType;
  if (innerType) return isOptional(innerType);
  return false;
}

/**
 * Extract a short hint from a Zod schema. We don't show full type info —
 * just enough for the operator to know what shape they're populating.
 */
function hintFor(def: z.ZodTypeAny): string {
  const peeled = unwrap(def);
  const tn =
    (peeled as unknown as { _def?: { typeName?: string }; def?: { type?: string } })._def
      ?.typeName ??
    (peeled as unknown as { def?: { type?: string } }).def?.type ??
    "";
  if (tn === "ZodString" || tn === "string") return "text";
  if (tn === "ZodNumber" || tn === "number" || tn === "ZodInt" || tn === "int") return "number";
  if (tn === "ZodBoolean" || tn === "boolean") return "true / false";
  if (tn === "ZodArray" || tn === "array") return "array of strings";
  if (tn === "ZodEnum" || tn === "enum") {
    const values =
      (peeled as unknown as { options?: string[] }).options ??
      Object.values(
        (peeled as unknown as { _def?: { values?: Record<string, string> } })._def?.values ?? {}
      );
    if (values && values.length > 0) {
      return values.slice(0, 4).join(" / ") + (values.length > 4 ? " / ..." : "");
    }
    return "enum";
  }
  return "";
}

function unwrap(def: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = def;
  for (let i = 0; i < 5; i += 1) {
    const innerType = (current as unknown as { _def?: { innerType?: z.ZodTypeAny } })._def
      ?.innerType;
    if (!innerType) return current;
    current = innerType;
  }
  return current;
}

interface Props {
  typeLabels: Record<ClassifiedType, string>;
}

export function ColumnReferencePanel({ typeLabels }: Props): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [activeType, setActiveType] = React.useState<ClassifiedType>("matrimonial_with_photo");

  const fields = describeSchema(FieldSchemaByType[activeType] as z.ZodTypeAny);

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="border-border-default bg-bg-surface rounded-lg border"
      data-testid="column-reference-panel"
    >
      <Collapsible.Trigger
        className="text-title-sm text-text-primary flex w-full items-center justify-between px-5 py-3"
        data-testid="column-reference-toggle"
      >
        <span>What columns do I need?</span>
        <CaretDown
          size={16}
          weight="bold"
          className={`text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="border-border-default border-t px-5 py-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(Object.keys(typeLabels) as ClassifiedType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveType(t)}
              data-testid={`column-reference-tab-${t}`}
              className={[
                "text-caption rounded-full px-3 py-1 transition-colors",
                activeType === t
                  ? "bg-accent text-text-inverse"
                  : "bg-bg-canvas text-text-secondary hover:text-text-primary",
              ].join(" ")}
            >
              {typeLabels[t]}
            </button>
          ))}
        </div>

        <div className="text-caption text-text-tertiary mb-2">
          Universal columns (every row): <code>type</code>, <code>language</code>,{" "}
          <code>weeks_to_run</code>, <code>billing_reference</code>.
        </div>

        <ul className="text-caption divide-border-default divide-y" data-testid="column-reference-fields">
          {fields.length === 0 ? (
            <li className="text-text-tertiary py-2">No fields registered for this type.</li>
          ) : (
            fields.map((f) => (
              <li key={f.name} className="flex items-start justify-between gap-3 py-2">
                <code className="text-text-primary">{f.name}</code>
                <div className="text-text-tertiary flex shrink-0 items-center gap-3 text-right">
                  <span>{f.hint}</span>
                  <span
                    className={
                      f.required
                        ? "bg-accent/10 text-accent rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase"
                        : "text-text-tertiary text-[11px] uppercase"
                    }
                  >
                    {f.required ? "required" : "optional"}
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
