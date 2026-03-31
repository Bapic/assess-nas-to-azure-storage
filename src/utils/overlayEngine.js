/**
 * Overlay Engine — Two-Layer Workload+Protocol Preference Resolution
 *
 * Layer 1 (default): preferred_choice_structured_mapping.json
 *   — Provides the base recommended service and outcome for every
 *     workload + protocol combination.  Populated from contextualPreferenceRules.
 *
 * Layer 2 (SME override): sme_preference_overrides.json
 *   — Lightweight delta file.  When an active entry matches the assessment's
 *     workload + protocol combo it wins over the default mapping result.
 *
 * Usage:
 *   const overlay = resolveWorkloadProtocolOverlay(answers);
 *   // overlay is null when nothing matched, otherwise:
 *   // { service, preferredOutcomeId, source, reason, mappingEntryId }
 */

import mappingData from "../data/preferred_choice_structured_mapping.json";
import smeOverridesData from "../data/sme_preference_overrides.json";

// ---------------------------------------------------------------------------
// Shared normalisation helpers
// ---------------------------------------------------------------------------

function normalizeProtocols(values) {
  if (!values) return [];
  const arr = Array.isArray(values) ? values : [values];
  return [...new Set(arr.map((v) => String(v).trim().toLowerCase()))].sort((a, b) =>
    a.localeCompare(b)
  );
}

/**
 * Map answer values back to the canonical workload labels used in the mapping file.
 * treeConfig stores verbose answer values; the mapping uses shorter labels.
 */
function normalizeWorkload(raw) {
  const value = String(raw ?? "").trim();
  const lower = value.toLowerCase();
  if (!value) return "";
  if (lower.includes("ai/ml") || lower.includes("feature stores")) {
    return "AI/ML workloads (training, features etc.)";
  }
  if (lower.includes("infrequently accessed") || lower.includes("archive")) {
    return "Infrequently used (archive, backup)";
  }
  if (lower === "mixed workloads") {
    return "Mixed workloads (various workloads combinations)";
  }
  // "Enterprise, mission-critical", "Databases and stateful app components",
  // "General-purpose file shares" — stored verbatim in both places.
  return value;
}

function protocolsMatch(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------
// Layer 1 — default mapping lookup (exact then superset fallback)
// ---------------------------------------------------------------------------

function findMappingEntry(mappedWorkload, normalizedProtocols) {
  // Exact protocol-set match first.
  const exact = mappingData.find((entry) => {
    if (entry.workloadType !== mappedWorkload) return false;
    return protocolsMatch(
      normalizeProtocols(entry.sourceProtocolValues),
      normalizedProtocols
    );
  }) ?? null;

  if (exact) return { entry: exact, matchType: "exact" };

  // Superset fallback: find mapping entries whose protocol set contains all of the
  // user-selected protocols. Prefer the smallest superset (fewest extra protocols).
  const supersetCandidates = mappingData
    .filter((entry) => {
      if (entry.workloadType !== mappedWorkload) return false;
      const entryProtos = normalizeProtocols(entry.sourceProtocolValues);
      return normalizedProtocols.every((p) => entryProtos.includes(p));
    })
    .sort((a, b) => {
      const aLen = normalizeProtocols(a.sourceProtocolValues).length;
      const bLen = normalizeProtocols(b.sourceProtocolValues).length;
      return aLen - bLen;
    });

  if (supersetCandidates.length > 0) {
    return { entry: supersetCandidates[0], matchType: "superset_fallback" };
  }

  return { entry: null, matchType: "none" };
}

function resolveFromMapping(entry, matchType = "exact") {
  if (!entry) return null;

  const rules = entry.contextualPreferenceRules?.[0];
  if (!rules) return null;

  // Group preferenceRanking by service, keeping highest-priority (lowest number) per service.
  const byService = {};
  for (const rank of (rules.preferenceRanking ?? [])) {
    const svc = rank.serviceName;
    if (!byService[svc] || (rank.priority ?? 99) < (byService[svc].priority ?? 99)) {
      byService[svc] = rank;
    }
  }

  const makeEntry = (rank) =>
    rank
      ? {
          preferredOutcomeId: rank.preferredOutcomeId ?? null,
          source: "mapping",
          reason: rules.reason ?? rank.rationale ?? "Default mapping preference.",
          mappingEntryId: entry.id,
          rationale: rank.rationale ?? null,
          matchType,
        }
      : null;

  const filesEntry = makeEntry(byService["files"] ?? null);
  const blobsEntry = makeEntry(byService["blobs"] ?? null);

  if (!filesEntry && !blobsEntry) return null;

  return { files: filesEntry, blobs: blobsEntry };
}

// ---------------------------------------------------------------------------
// Layer 2 — SME override lookup
// ---------------------------------------------------------------------------

function isInActiveWindow(override) {
  const today = new Date().toISOString().slice(0, 10);
  if (override.effectiveDate && today < override.effectiveDate) return false;
  if (override.expiryDate && today > override.expiryDate) return false;
  return true;
}

function findSmeOverride(mappedWorkload, normalizedProtocols) {
  const overrides = Array.isArray(smeOverridesData?.overrides)
    ? smeOverridesData.overrides
    : [];

  return (
    overrides.find((o) => {
      if (String(o?.status ?? "active").toLowerCase() !== "active") return false;
      if (!isInActiveWindow(o)) return false;
      if (normalizeWorkload(o.workload) !== mappedWorkload) return false;
      return protocolsMatch(normalizeProtocols(o.protocol), normalizedProtocols);
    }) ?? null
  );
}

function resolveFromSmeOverride(override) {
  if (!override) return null;
  const svc = override.overridePreference; // "files" | "blobs"
  const entry = {
    preferredOutcomeId: override.preferredOutcomeId ?? null,
    source: "sme_override",
    reason: override.reason ?? "SME preference override.",
    mappingEntryId: null,
    rationale: null,
  };
  return {
    files: svc === "files" ? entry : null,
    blobs: svc === "blobs" ? entry : null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the two-layer overlay for the given assessment answers.
 *
 * Returns an object with independent per-service entries, or null when no
 * mapping entry matched at all.
 *
 * Shape:
 *   {
 *     files: {
 *       preferredOutcomeId: string | null
 *       source:            "mapping" | "sme_override"
 *       reason:            string
 *       mappingEntryId:    string | null
 *       rationale:         string | null
 *     } | null,
 *     blobs: { ...same shape... } | null
 *   }
 */
export function resolveWorkloadProtocolOverlay(answers) {
  // Derive workload: multiselect — use first selected value for matching.
  const rawWorkload = Array.isArray(answers?.workloadType)
    ? answers.workloadType[0]
    : answers?.workloadType;

  const mappedWorkload = normalizeWorkload(rawWorkload);
  const protocols = normalizeProtocols(answers?.sourceProtocol);

  if (!mappedWorkload || protocols.length === 0) return null;

  // Layer 1 — default mapping (per-service, with superset fallback)
  const { entry: mappingEntry, matchType } = findMappingEntry(mappedWorkload, protocols);
  const defaultOverlay = resolveFromMapping(mappingEntry, matchType);

  // Layer 2 — SME override wins per service when present and active
  const smeOverride = findSmeOverride(mappedWorkload, protocols);
  const smeOverlayResult = resolveFromSmeOverride(smeOverride);

  if (!defaultOverlay && !smeOverlayResult) return null;

  // Merge: SME override wins per service; other service falls back to mapping layer
  return {
    files: smeOverlayResult?.files ?? defaultOverlay?.files ?? null,
    blobs: smeOverlayResult?.blobs ?? defaultOverlay?.blobs ?? null,
  };
}
