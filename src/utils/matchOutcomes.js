import { isAvailableInRegion } from "../data/regionAvailability.js";
import { serviceOutcomeMap } from "../data/treeConfig.js";
import { supportsRedundancy } from "../data/redundancyAvailability.js";
import preferredChoiceStructuredMappings from "../data/preferred_choice_structured_mapping.json";

const blobTierMap = {
  hot: "blob-hot",
  cool: "blob-cool",
  cold: "blob-cold",
  archive: "blob-archive",
};

const blobTierOrder = ["blob-hot", "blob-cool", "blob-cold", "blob-archive"];
const redundancyFallbackChain = ["gzrs", "grs", "zrs", "lrs"];
const filesMediaTypeMap = { ssd: "files-premium-ssd", hdd: "files-standard-hdd" };
const filesOutcomeIds = Object.values(filesMediaTypeMap);
const blobOutcomeIds = Object.values(blobTierMap);
const filesPerformanceThresholds = {
  maxShareSizeGb: 256000,
  hddMaxIops: 50000,
  hddMaxThroughputMibps: 5120,
  filesMaxIops: 102400,
  filesMaxThroughputMibps: 10340,
};

function toFilesOutcomeIds(filesMediaType) {
  if (!filesMediaType) return [];
  if (Array.isArray(filesMediaType)) {
    return filesMediaType
      .map((mediaType) => filesMediaTypeMap[mediaType])
      .filter(Boolean);
  }
  const mapped = filesMediaTypeMap[filesMediaType];
  return mapped ? [mapped] : [];
}

function getAlternateFilesOutcomeId(outcomeId) {
  return outcomeId === "files-premium-ssd"
    ? "files-standard-hdd"
    : outcomeId === "files-standard-hdd"
      ? "files-premium-ssd"
      : null;
}

/**
 * Decide Azure Files SKU suitability from source scale/performance inputs.
 *
 * Rule set:
 *  - HDD eligible:    size < 256000 GB AND IOPS < 50000 AND throughput < 5120 MiB/s
 *  - SSD eligible:    size < 256000 GB AND IOPS < 102400 AND throughput < 10340 MiB/s
 *  - A SKU is Not Ready when any of its threshold limits are reached/exceeded.
 */
export function getFilesPerformanceSkuEligibility(answers) {
  const shareSizeGb = Number(answers?.sourceShareSizeTb);
  const iops = Number(answers?.sourceIops);
  const throughputMibps = Number(answers?.sourceThroughputMibps);
  const metricsPresent = [shareSizeGb, iops, throughputMibps].every(
    (value) => Number.isFinite(value) && value >= 0
  );

  if (!metricsPresent) {
    return {
      scenario: "not-evaluated",
      allowedOutcomeIds: [...filesOutcomeIds],
      metrics: { shareSizeGb, iops, throughputMibps },
      thresholds: filesPerformanceThresholds,
    };
  }

  const hddEligible =
    shareSizeGb < filesPerformanceThresholds.maxShareSizeGb
    && iops < filesPerformanceThresholds.hddMaxIops
    && throughputMibps < filesPerformanceThresholds.hddMaxThroughputMibps;

  const ssdEligible =
    shareSizeGb < filesPerformanceThresholds.maxShareSizeGb
    && iops < filesPerformanceThresholds.filesMaxIops
    && throughputMibps < filesPerformanceThresholds.filesMaxThroughputMibps;

  if (!hddEligible && !ssdEligible) {
    return {
      scenario: "none",
      allowedOutcomeIds: [],
      metrics: { shareSizeGb, iops, throughputMibps },
      thresholds: filesPerformanceThresholds,
    };
  }

  if (!hddEligible && ssdEligible) {
    return {
      scenario: "ssd-only",
      allowedOutcomeIds: [filesMediaTypeMap.ssd],
      metrics: { shareSizeGb, iops, throughputMibps },
      thresholds: filesPerformanceThresholds,
    };
  }

  if (hddEligible && ssdEligible) {
    return {
      scenario: "both",
      allowedOutcomeIds: [...filesOutcomeIds],
      metrics: { shareSizeGb, iops, throughputMibps },
      thresholds: filesPerformanceThresholds,
    };
  }

  return {
    scenario: ssdEligible ? "ssd-only" : "none",
    allowedOutcomeIds: ssdEligible ? [filesMediaTypeMap.ssd] : [],
    metrics: { shareSizeGb, iops, throughputMibps },
    thresholds: filesPerformanceThresholds,
  };
}

/**
 * Returns Azure Files Pv2 regional availability status for the selected region.
 * Service is considered available when at least one Pv2 SKU (HDD/SSD) is region-available.
 */
export function getFilesPv2RegionAvailability(
  answers,
  availabilityFn = isAvailableInRegion
) {
  const selectedServices = answers?.targetService ?? [];
  const selectedRegion = answers?.region;

  if (!selectedServices.includes("files")) return null;
  if (!selectedRegion) return null;

  const requestedOutcomeIds = toFilesOutcomeIds(answers?.filesMediaType);
  const availableServiceOutcomeIds = filesOutcomeIds.filter((outcomeId) =>
    availabilityFn(outcomeId, selectedRegion)
  );
  const availableRequestedOutcomeIds = requestedOutcomeIds.filter((outcomeId) =>
    availabilityFn(outcomeId, selectedRegion)
  );

  return {
    requestedOutcomeIds,
    availableServiceOutcomeIds,
    availableRequestedOutcomeIds,
    serviceAvailable: availableServiceOutcomeIds.length > 0,
  };
}

function getRedundancyCandidates(requestedRedundancy) {
  const requestedIndex = redundancyFallbackChain.indexOf(requestedRedundancy);
  if (requestedIndex === -1) return [requestedRedundancy];
  return redundancyFallbackChain.slice(requestedIndex);
}

/**
 * Resolve a selected redundancy to an effective per-outcome value by applying
 * downgrade fallback in this order: GZRS -> GRS -> ZRS -> LRS.
 */
export function getOutcomeRedundancyAdjustment(
  answers,
  outcomeId,
  supportFn = supportsRedundancy
) {
  const selectedRedundancy = answers?.redundancy;
  if (!selectedRedundancy) return null;

  const applied = getRedundancyCandidates(selectedRedundancy).find((candidate) =>
    supportFn(outcomeId, candidate)
  );

  if (!applied) return null;

  return {
    requested: selectedRedundancy,
    applied,
  };
}

/**
 * If a selected Azure Files SKU is unavailable in the selected region,
 * continue with the alternate Files SKU (HDD <-> SSD) when available.
 */
export function getFilesSkuRegionAdjustment(
  answers,
  availabilityFn = isAvailableInRegion
) {
  const filesPv2RegionAvailability = getFilesPv2RegionAvailability(answers, availabilityFn);
  if (!filesPv2RegionAvailability) return null;

  const requestedOutcomeIds = filesPv2RegionAvailability.requestedOutcomeIds;
  if (requestedOutcomeIds.length === 0) return null;

  const selectedRegion = answers?.region;

  const substitutions = [];
  const appliedOutcomeSet = new Set(
    requestedOutcomeIds.filter((outcomeId) => availabilityFn(outcomeId, selectedRegion))
  );

  requestedOutcomeIds.forEach((requestedOutcomeId) => {
    if (availabilityFn(requestedOutcomeId, selectedRegion)) return;

    const alternateOutcomeId = getAlternateFilesOutcomeId(requestedOutcomeId);
    const appliedOutcomeId =
      alternateOutcomeId && availabilityFn(alternateOutcomeId, selectedRegion)
        ? alternateOutcomeId
        : null;

    if (appliedOutcomeId) {
      appliedOutcomeSet.add(appliedOutcomeId);
    }

    substitutions.push({
      requested: requestedOutcomeId,
      applied: appliedOutcomeId,
    });
  });

  if (substitutions.length === 0) return null;

  const fallbackOutcomeIds = substitutions
    .map((item) => item.applied)
    .filter(Boolean)
    .filter((outcomeId) => !requestedOutcomeIds.includes(outcomeId));

  return {
    requestedOutcomeIds,
    appliedOutcomeIds: [...appliedOutcomeSet],
    substitutions,
    fallbackOutcomeIds,
    serviceAvailable: filesPv2RegionAvailability.serviceAvailable,
  };
}

/**
 * If a selected Blob tier is unavailable in the selected region, move to the
 * nearest warmer tier (archive -> cold -> cool -> hot) that is available.
 */
export function getBlobTierRegionAdjustment(answers, availabilityFn = isAvailableInRegion) {
  const selectedServices = answers?.targetService ?? [];
  const selectedRegion = answers?.region;
  const requestedTier = answers?.blobAccessFrequency;

  if (!selectedServices.includes("blobs")) return null;
  if (!selectedRegion || !requestedTier) return null;

  const requestedOutcomeId = blobTierMap[requestedTier];
  if (!requestedOutcomeId) return null;
  if (availabilityFn(requestedOutcomeId, selectedRegion)) return null;

  const requestedIndex = blobTierOrder.indexOf(requestedOutcomeId);
  const appliedOutcomeId = blobTierOrder
    .slice(0, requestedIndex)
    .reverse()
    .find((outcomeId) => availabilityFn(outcomeId, selectedRegion));

  if (!appliedOutcomeId) return null;

  return {
    requested: requestedOutcomeId,
    applied: appliedOutcomeId,
  };
}

/**
 * Archive-specific helper retained for UI messaging compatibility.
 * Uses the generic per-outcome downgrade chain when Archive is selected.
 */
export function getBlobArchiveRedundancyAdjustment(answers) {
  const selectedServices = answers?.targetService ?? [];
  if (!selectedServices.includes("blobs")) return null;
  if (answers?.blobAccessFrequency !== "archive") return null;

  const adjustment = getOutcomeRedundancyAdjustment(answers, "blob-archive");
  if (!adjustment || adjustment.requested === adjustment.applied) return null;
  return adjustment;
}

/**
 * Returns all outcomes that pass four gates:
 *  1. Service gate    — outcome belongs to at least one of the user-selected target services
 *  2. Region gate     — outcome is available in the selected region
 *  3. Redundancy gate — requested redundancy is supported directly or via per-outcome downgrade
 *  4. Rules gate      — at least one rule set is fully satisfied by the user's answers
 */
export function getEligibleOutcomes(outcomes, answers) {
  const selectedRegion = answers.region;
  const selectedServices = answers.targetService; // array | undefined
  const selectedRedundancy = answers.redundancy;   // string | undefined
  const sourceProtocolValues = Array.isArray(answers?.sourceProtocol)
    ? answers.sourceProtocol.map((value) => String(value).toLowerCase())
    : [String(answers?.sourceProtocol ?? "").toLowerCase()];
  const sourceProtocolJoined = sourceProtocolValues.join(",");
  const sourceHasSmb =
    sourceProtocolValues.includes("smb_v2")
    || sourceProtocolValues.includes("smb_v3")
    || sourceProtocolJoined.includes("smb");
  const sourceHasS3 = sourceProtocolValues.includes("s3") || sourceProtocolJoined.includes("s3");
  const sourceHasNfsV3 =
    sourceProtocolValues.includes("nfs_v3") || sourceProtocolJoined.includes("nfs_v3");
  const sourceHasNfsV41 =
    sourceProtocolValues.includes("nfs_v41") || sourceProtocolJoined.includes("nfs_v41");
  const sourceHasNfs = sourceHasNfsV3 || sourceHasNfsV41 || sourceProtocolJoined.includes("nfs");
  const blobProtocolSupported = sourceHasS3 || sourceHasNfsV3;
  const filesProtocolSupported = sourceHasSmb || sourceHasNfsV41;
  const selectedServicesList = Array.isArray(selectedServices) ? selectedServices : [];
  const filesSelected = selectedServicesList.includes("files");
  const blobsSelected = selectedServicesList.includes("blobs");
  const autoIncludeBlobForProtocolPriority =
    filesSelected && blobProtocolSupported && !blobsSelected;
  const effectiveServices = autoIncludeBlobForProtocolPriority
    ? [...new Set([...selectedServicesList, "blobs"])]
    : selectedServicesList;
  const forcedBlobAccessFrequency = autoIncludeBlobForProtocolPriority ? "hot" : null;
  const blobTierRegionAdjustment = getBlobTierRegionAdjustment(answers);
  const filesSkuRegionAdjustment = getFilesSkuRegionAdjustment(answers);
  const filesPerformanceEligibility = getFilesPerformanceSkuEligibility(answers);

  // Build the set of outcome IDs allowed by the selected services
  const allowedByService =
    effectiveServices.length > 0
      ? new Set(effectiveServices.flatMap((svc) => serviceOutcomeMap[svc] ?? []))
      : null;

  return outcomes.filter((outcome) => {
    // --- Service gate ---
    if (allowedByService && !allowedByService.has(outcome.id)) return false;

    // --- Region gate ---
    if (selectedRegion && !isAvailableInRegion(outcome.id, selectedRegion)) return false;

    // --- Blob tier gate ---
    // Maps access frequency answer directly to one of the four Blob tier outcome IDs.
    const effectiveBlobAccessFrequency = answers.blobAccessFrequency ?? forcedBlobAccessFrequency;
    if (effectiveBlobAccessFrequency) {
      const requestedBlobOutcomeId = blobTierMap[effectiveBlobAccessFrequency];
      const effectiveBlobOutcomeId = blobTierRegionAdjustment?.applied ?? requestedBlobOutcomeId;
      const isBlobTierOutcome = Object.values(blobTierMap).includes(outcome.id);

      // Blob protocol policy: assess Blob only for S3 or NFS v3 source protocol paths.
      if (isBlobTierOutcome && !blobProtocolSupported) {
        return false;
      }

      if (isBlobTierOutcome && outcome.id !== effectiveBlobOutcomeId) {
        return false;
      }
    }

    // --- Media type gate (Azure Files outcomes only) ---
    // One or more of files-premium-ssd / files-standard-hdd can be eligible.
    // If selected Files SKU is region-unavailable, fallback to the alternate SKU when possible.
    // For NFS source protocols, Azure Files Standard HDD is excluded.
    // Source size/IOPS/throughput also drive Files SKU eligibility.
    {
      const selectedFilesMediaOutcomes = answers.filesMediaType
        ? filesSkuRegionAdjustment?.appliedOutcomeIds ?? toFilesOutcomeIds(answers.filesMediaType)
        : [];
      const isFilesMediaOutcome = filesOutcomeIds.includes(outcome.id);

      // Files protocol policy: assess Files only for SMB or NFS v4.1 source protocol paths.
      if (isFilesMediaOutcome && !filesProtocolSupported) {
        return false;
      }

      // Azure Files supports NFS v4.1 but not NFS v3. If the source protocol is NFS v3-only,
      // Files outcomes are excluded and Blob Hot is auto-included by service/tier defaults above.
      if (isFilesMediaOutcome && sourceHasNfsV3 && !sourceHasNfsV41 && !sourceHasSmb) {
        return false;
      }

      if (
        isFilesMediaOutcome
        && !filesPerformanceEligibility.allowedOutcomeIds.includes(outcome.id)
      ) {
        return false;
      }

      if (sourceHasNfs && outcome.id === "files-standard-hdd") {
        return false;
      }

      if (
        isFilesMediaOutcome
        && selectedFilesMediaOutcomes.length > 0
        && !selectedFilesMediaOutcomes.includes(outcome.id)
      ) {
        return false;
      }
    }

    // --- Redundancy gate ---
    // If the requested redundancy is unsupported by this outcome, downgrade by:
    // GZRS -> GRS -> ZRS -> LRS until a supported value is found.
    if (selectedRedundancy) {
      const redundancyAdjustment = getOutcomeRedundancyAdjustment(answers, outcome.id);
      if (!redundancyAdjustment) return false;
    }

    // --- Rules gate ---
    if (!outcome.rules || outcome.rules.length === 0) return true;

    return outcome.rules.some((ruleSet) =>
      Object.entries(ruleSet).every(
        ([questionId, requiredValue]) => answers[questionId] === requiredValue
      )
    );
  });
}

function getCanonicalProtocolLabel(values) {
  const normalizedValues = Array.isArray(values)
    ? values.map((value) => String(value).toLowerCase())
    : [String(values ?? "").toLowerCase()];
  const hasS3 = normalizedValues.includes("s3");
  const hasNfsV3 = normalizedValues.includes("nfs_v3");
  const hasNfsV41 = normalizedValues.includes("nfs_v41");
  const hasNfs = hasNfsV3 || hasNfsV41;
  const hasSmbV2 = normalizedValues.includes("smb_v2");
  const hasSmbV3 = normalizedValues.includes("smb_v3");
  const hasSmb = hasSmbV2 || hasSmbV3;

  if (hasSmb && hasNfs && hasS3) return "SMB, NFS and S3";
  if (hasSmb && hasNfs) return "SMB and NFS";
  if (hasSmb && hasS3) return "SMB and S3";
  if (hasNfs && hasS3) return "NFS and S3";
  if (hasS3) return "S3";
  if (hasNfsV3 && hasNfsV41) return "NFS 3, 4.1";
  if (hasNfs) return "NFS";
  if (hasSmbV2 && hasSmbV3) return "SMB 2.x, 3.x";
  if (hasSmbV2) return "SMB 2.x";
  if (hasSmbV3) return "SMB 3.x";
  return "";
}

function getCanonicalProtocolKey(values) {
  const normalizedValues = Array.isArray(values)
    ? values.map((value) => String(value).toLowerCase())
    : [String(values ?? "").toLowerCase()];

  const hasSmbV2 = normalizedValues.includes("smb_v2");
  const hasSmbV3 = normalizedValues.includes("smb_v3");
  const hasNfsV3 = normalizedValues.includes("nfs_v3");
  const hasNfsV41 = normalizedValues.includes("nfs_v41");
  const hasS3 = normalizedValues.includes("s3");

  const canonicalValues = [];
  if (hasSmbV2) canonicalValues.push("smb_v2");
  if (hasSmbV3) canonicalValues.push("smb_v3");
  if (hasNfsV3) canonicalValues.push("nfs_v3");
  if (hasNfsV41) canonicalValues.push("nfs_v41");
  if (hasS3) canonicalValues.push("s3");

  return [...new Set(canonicalValues)].sort().join("+");
}

function getLegacyProtocolKey(values) {
  const normalizedValues = Array.isArray(values)
    ? values.map((value) => String(value).toLowerCase())
    : [String(values ?? "").toLowerCase()];

  const hasSmb = normalizedValues.includes("smb_v2") || normalizedValues.includes("smb_v3");
  const hasNfsV3 = normalizedValues.includes("nfs_v3");
  const hasNfsV41 = normalizedValues.includes("nfs_v41");
  const hasS3 = normalizedValues.includes("s3");

  const canonicalValues = [];
  if (hasSmb) canonicalValues.push("smb_v2", "smb_v3");
  if (hasNfsV3) canonicalValues.push("nfs_v3");
  if (hasNfsV41) canonicalValues.push("nfs_v41");
  if (hasS3) canonicalValues.push("s3");

  return [...new Set(canonicalValues)].sort().join("+");
}

function findPreferredChoiceRow(answers) {
  const workloadType = answers?.workloadType;
  const canonicalProtocol = getCanonicalProtocolLabel(answers?.sourceProtocol);
  const canonicalProtocolKey = getCanonicalProtocolKey(answers?.sourceProtocol);
  if (!workloadType || !canonicalProtocolKey) {
    return { row: null, canonicalProtocol, canonicalProtocolKey };
  }

  const row = preferredChoiceStructuredMappings.find((item) =>
    item.workloadType === workloadType
    && item.sourceProtocolKey === canonicalProtocolKey
  ) ?? preferredChoiceStructuredMappings.find((item) => {
    const legacyProtocolKey = getLegacyProtocolKey(answers?.sourceProtocol);
    return item.workloadType === workloadType && item.sourceProtocolKey === legacyProtocolKey;
  }) ?? null;

  return { row, canonicalProtocol, canonicalProtocolKey };
}

/**
 * Track B = preferred-choice mapping (workload + source protocol) overlaid on
 * Track A eligibility. Preferred choice prevails in recommendation when mismatch exists.
 */
export function getTrackBSelection(outcomes, answers, trackAEligibleOutcomes = []) {
  const trackAOutcomeIds = new Set((trackAEligibleOutcomes ?? []).map((item) => item.id));
  const selectedServices = Array.isArray(answers?.targetService) ? answers.targetService : [];
  const sourceProtocolValues = Array.isArray(answers?.sourceProtocol)
    ? answers.sourceProtocol.map((value) => String(value).toLowerCase())
    : [String(answers?.sourceProtocol ?? "").toLowerCase()];
  const sourceHasS3 = sourceProtocolValues.includes("s3");
  const sourceHasNfsV3 = sourceProtocolValues.includes("nfs_v3");
  const autoIncludeBlobForProtocolPriority =
    selectedServices.includes("files") && (sourceHasS3 || sourceHasNfsV3) && !selectedServices.includes("blobs");
  const effectiveServices = autoIncludeBlobForProtocolPriority
    ? [...new Set([...selectedServices, "blobs"])]
    : selectedServices;
  const allowedByService = new Set(effectiveServices.flatMap((svc) => serviceOutcomeMap[svc] ?? []));

  const { row: preferredRow, canonicalProtocol, canonicalProtocolKey } = findPreferredChoiceRow(answers);
  const preferredOutcomeIds = [
    preferredRow?.preferredBlobOutcomeId,
    preferredRow?.preferredFilesOutcomeId,
  ].filter(Boolean);

  const preferredByService = {
    blob: preferredOutcomeIds.find((id) => blobOutcomeIds.includes(id)) ?? null,
    files: preferredOutcomeIds.find((id) => filesOutcomeIds.includes(id)) ?? null,
  };

  const trackBOutcomeSet = new Set(
    (trackAEligibleOutcomes ?? [])
      .map((outcome) => outcome.id)
      .filter((id) => allowedByService.has(id))
  );

  preferredOutcomeIds
    .filter((id) => allowedByService.has(id))
    .forEach((id) => trackBOutcomeSet.add(id));

  const trackBOutcomes = (outcomes ?? []).filter((outcome) => trackBOutcomeSet.has(outcome.id));

  const matchedPreferredToTrackA = {
    blob: preferredByService.blob ? trackAOutcomeIds.has(preferredByService.blob) : null,
    files: preferredByService.files ? trackAOutcomeIds.has(preferredByService.files) : null,
  };

  return {
    outcomes: trackBOutcomes,
    preferredByService,
    preferredRow,
    canonicalProtocol,
    canonicalProtocolKey,
    matchedPreferredToTrackA,
  };
}
