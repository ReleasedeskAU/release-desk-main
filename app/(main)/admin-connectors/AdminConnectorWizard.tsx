"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Minus, X } from "lucide-react";
import { SourceLogo } from "@/components/admin-connectors/SourceLogo";
import { getFetchSummary } from "@/lib/admin-connectors/fetch-summary";
import type { AdminConnectorSource, CatalogField } from "@/lib/admin-connectors/types";
import { COMING_SOON_COPY, FULL_ACCOUNT_WARNING, warnsFullAccount } from "@/lib/admin-connectors/types";
import { controlLoc, fieldLoc } from "@/lib/ui-control-locators";

const STEP_CREDENTIALS = 1;
const STEP_FETCH = 2;
const STEP_SCOPE = 3;
const STEP_ADVANCED = 4;

function initialFieldValue(field: CatalogField): string | boolean | number {
  if (field.type === "checkbox") return field.default === true;
  if (field.type === "number") return field.default ?? "";
  if (typeof field.default === "string") return field.default;
  return "";
}

function FieldInput({
  field,
  value,
  onChange,
  prefix,
}: {
  field: CatalogField;
  value: string | boolean | number;
  onChange: (value: string | boolean | number) => void;
  prefix: string;
}) {
  const loc = fieldLoc(`${prefix}_${field.name}`, field.name);
  const common =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#2548C9] focus:outline-none";

  if (field.type === "checkbox") {
    return (
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5"
          {...loc}
        />
        <span>
          <span className="font-medium">{field.label}</span>
          {field.help && <span className="block text-[12px] text-gray-500 font-normal">{field.help}</span>}
        </span>
      </label>
    );
  }

  if (field.type === "list") {
    return (
      <div>
        <label htmlFor={loc.id} className="block text-sm font-medium text-gray-800 mb-1">
          {field.label}
          {field.optional ? " (optional)" : ""}
        </label>
        <textarea
          rows={3}
          className={common}
          placeholder="One value per line"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          {...loc}
        />
        {field.help && <p className="mt-1 text-[12px] text-gray-500">{field.help}</p>}
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div>
        <label htmlFor={loc.id} className="block text-sm font-medium text-gray-800 mb-1">
          {field.label}
        </label>
        <select
          className={common}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          {...loc}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {field.help && <p className="mt-1 text-[12px] text-gray-500">{field.help}</p>}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={loc.id} className="block text-sm font-medium text-gray-800 mb-1">
        {field.label}
        {field.optional ? " (optional)" : ""}
      </label>
      <input
        type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
        className={common}
        value={value === true || value === false ? "" : value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        {...loc}
      />
      {field.help && <p className="mt-1 text-[12px] text-gray-500">{field.help}</p>}
    </div>
  );
}

/**
 * Read-only list of what this source indexes. Scope filters stay on the next step.
 */
function FetchSummaryPanel({ sourceId }: { sourceId: string }) {
  const summary = getFetchSummary(sourceId);
  return (
    <div className="space-y-5" {...controlLoc("admin_connectors_fetch_summary")}>
      <p className="text-sm text-gray-600">
        After you connect, these are the items this source puts into Ask. This list is not a filter —
        choose scope on the next step.
      </p>
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Fetched</h3>
        <ul className="space-y-2">
          {summary.fetches.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-gray-800">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      {summary.skips.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 mb-2">Not fetched</h3>
          <ul className="space-y-2">
            {summary.skips.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-500">
                <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function valuesToRecord(
  fields: CatalogField[],
  values: Record<string, string | boolean | number>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    out[field.name] = values[field.name];
  }
  return out;
}

export function AdminConnectorWizard({
  source,
  onClose,
  onSaved,
}: {
  source: AdminConnectorSource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ready = source.comingSoon == null;
  const hasCreds = source.credentialFields.length > 0;
  const firstStep = hasCreds ? STEP_CREDENTIALS : STEP_FETCH;
  const [step, setStep] = useState(firstStep);
  const [name, setName] = useState(source.label);
  const [pollInterval, setPollInterval] = useState(15);
  const [indexingStart, setIndexingStart] = useState("");
  const [credValues, setCredValues] = useState<Record<string, string | boolean | number>>(() =>
    Object.fromEntries(source.credentialFields.map((field) => [field.name, initialFieldValue(field)]))
  );
  const [configValues, setConfigValues] = useState<Record<string, string | boolean | number>>(() =>
    Object.fromEntries(source.configFields.map((field) => [field.name, initialFieldValue(field)]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = useMemo(() => {
    return [
      ...(hasCreds ? [{ n: STEP_CREDENTIALS, label: "Credentials" }] : []),
      { n: STEP_FETCH, label: "What we fetch" },
      { n: STEP_SCOPE, label: "What to index" },
      { n: STEP_ADVANCED, label: "Advanced" },
    ];
  }, [hasCreds]);

  const stepIndex = steps.findIndex((item) => item.n === step);
  const stepLabel = `Step ${stepIndex + 1} of ${steps.length}`;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: source.id,
          name,
          credentials: valuesToRecord(source.credentialFields, credValues),
          config: valuesToRecord(source.configFields, configValues),
          pollInterval,
          indexingStart: indexingStart || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not create this connector");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create this connector");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-2xl rounded-xl bg-white shadow-xl max-h-[90vh] overflow-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-connectors-wizard-title"
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <SourceLogo sourceId={source.id} size="sm" />
            <div className="min-w-0">
              <h2 id="admin-connectors-wizard-title" className="text-xl font-bold text-gray-900 truncate">
                Add {source.label}
              </h2>
              <p className="text-sm text-gray-500">{stepLabel}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} {...controlLoc("admin_connectors_close")}>
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6">
          <ol className="flex flex-wrap gap-x-4 gap-y-1 mb-6 text-[13px] font-medium">
            {steps.map((item, index) => {
              const isCurrent = step === item.n;
              const canGoBack = ready && index < stepIndex;
              const className = isCurrent ? "text-[#2548C9]" : canGoBack ? "text-gray-600" : "text-gray-400";
              const label = `${index + 1}. ${item.label}`;
              return (
                <li key={item.n} className={className}>
                  {canGoBack ? (
                    <button
                      type="button"
                      className="hover:text-[#2548C9] hover:underline"
                      onClick={() => setStep(item.n)}
                      {...controlLoc(`admin_connectors_step_${item.n}`)}
                    >
                      {label}
                    </button>
                  ) : (
                    <span>{label}</span>
                  )}
                </li>
              );
            })}
          </ol>

          {!ready && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 mb-4">
              {source.comingSoon ? COMING_SOON_COPY[source.comingSoon] : "This source cannot be added yet."}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {ready && step === STEP_CREDENTIALS && (
            <div className="space-y-4">
              {source.credentialFields.map((field) => (
                <FieldInput
                  key={field.name}
                  field={field}
                  prefix="admin_connectors_cred"
                  value={credValues[field.name]}
                  onChange={(value) => setCredValues((prev) => ({ ...prev, [field.name]: value }))}
                />
              ))}
            </div>
          )}

          {ready && step === STEP_FETCH && <FetchSummaryPanel sourceId={source.id} />}

          {ready && step === STEP_SCOPE && (
            <div className="space-y-4">
              {warnsFullAccount(source) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {FULL_ACCOUNT_WARNING}
                </div>
              )}
              {source.configFields.length === 0 ? (
                <p className="text-sm text-gray-600">
                  No further filters for this source. Continue to set a name and schedule.
                </p>
              ) : (
                source.configFields.map((field) => (
                  <FieldInput
                    key={field.name}
                    field={field}
                    prefix="admin_connectors_config"
                    value={configValues[field.name]}
                    onChange={(value) => setConfigValues((prev) => ({ ...prev, [field.name]: value }))}
                  />
                ))
              )}
            </div>
          )}

          {ready && step === STEP_ADVANCED && (
            <div className="space-y-4">
              <div>
                <label htmlFor="admin_connectors_name" className="block text-sm font-medium text-gray-800 mb-1">
                  Connector name
                </label>
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  {...fieldLoc("admin_connectors_name", "name")}
                />
              </div>
              <div>
                <label htmlFor="admin_connectors_poll" className="block text-sm font-medium text-gray-800 mb-1">
                  Refresh interval (minutes)
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={pollInterval}
                  onChange={(e) => setPollInterval(Number(e.target.value) || 15)}
                  {...fieldLoc("admin_connectors_poll", "pollInterval")}
                />
              </div>
              <div>
                <label htmlFor="admin_connectors_indexing_start" className="block text-sm font-medium text-gray-800 mb-1">
                  Index from date (optional)
                </label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={indexingStart}
                  onChange={(e) => setIndexingStart(e.target.value)}
                  {...fieldLoc("admin_connectors_indexing_start", "indexingStart")}
                />
              </div>
            </div>
          )}

          {ready && (
            <div className="mt-8 flex gap-3">
              {step > firstStep && (
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
                  onClick={() => setStep((n) => n - 1)}
                  {...controlLoc("admin_connectors_back")}
                >
                  Back
                </button>
              )}
              {step < STEP_ADVANCED && (
                <button
                  type="button"
                  className="rounded-lg bg-[#2548C9] px-4 py-2 text-sm font-semibold text-white"
                  onClick={() => setStep((n) => n + 1)}
                  {...controlLoc("admin_connectors_next")}
                >
                  Next
                </button>
              )}
              {step === STEP_ADVANCED && (
                <button
                  type="button"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2548C9] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  onClick={() => void submit()}
                  {...controlLoc("admin_connectors_create")}
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
