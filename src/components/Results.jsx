import { isAvailableInRegion } from "../data/regionAvailability.js";
import { serviceOutcomeMap } from "../data/treeConfig.js";
import {
  getOutcomeRedundancyAdjustment,
  getBlobTierRegionAdjustment,
  getFilesSkuRegionAdjustment,
  getFilesPv2RegionAvailability,
  getFilesPerformanceSkuEligibility,
} from "../utils/matchOutcomes.js";

const blobTierMap = {
  hot: "blob-hot",
  cool: "blob-cool",
  cold: "blob-cold",
  archive: "blob-archive",
};

const filesMediaTypeMap = {
  ssd: "files-premium-ssd",
  hdd: "files-standard-hdd",
};

const blobOutcomeIds = Object.values(blobTierMap);
const filesOutcomeIds = Object.values(filesMediaTypeMap);

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

/**
 * Resolve a stored answer value (string or array) to a human-readable label
 * using the question's options list.
 */
function resolveLabel(question, value) {
  if (!question.options) return String(value);

  // Flatten grouped options into a single list for lookup
  const flat = question.options[0]?.group !== undefined
    ? question.options.flatMap((g) => g.items)
    : question.options;

  if (Array.isArray(value)) {
    const labels = value.map((v) => flat.find((o) => o.value === v)?.label ?? v);
    return labels.join(", ");
  }
  return flat.find((o) => o.value === value)?.label ?? value;
}

function getOutcomeTierLabel(outcome) {
  const rightSide = outcome.title?.split("—")?.[1]?.trim();
  return rightSide || "N/A";
}

function getBestOutcomeByRank(candidates, rankMap) {
  if (!candidates || candidates.length === 0) return null;

  return candidates.reduce((best, current) => {
    const bestRank = rankMap[best.id] ?? -1;
    const currentRank = rankMap[current.id] ?? -1;
    return currentRank > bestRank ? current : best;
  });
}

function getReadinessPriority(readinessState) {
  if (readinessState === "Ready") return 3;
  if (readinessState === "Ready with Condition") return 2;
  return 1;
}

function getBestOutcomeByReadinessThenRank(candidates, rankMap, readinessByOutcomeId) {
  if (!candidates || candidates.length === 0) return null;

  return candidates.reduce((best, current) => {
    const bestReadiness = readinessByOutcomeId.get(best.id)?.readinessState ?? "Not Ready";
    const currentReadiness = readinessByOutcomeId.get(current.id)?.readinessState ?? "Not Ready";
    const bestReadinessScore = getReadinessPriority(bestReadiness);
    const currentReadinessScore = getReadinessPriority(currentReadiness);

    if (currentReadinessScore !== bestReadinessScore) {
      return currentReadinessScore > bestReadinessScore ? current : best;
    }

    const bestRank = rankMap[best.id] ?? -1;
    const currentRank = rankMap[current.id] ?? -1;
    return currentRank > bestRank ? current : best;
  });
}

function getFilesOutcomeByLowerSkuEscalation(candidates, rankMap, readinessByOutcomeId) {
  if (!candidates || candidates.length === 0) return null;

  // Lower rank means lower SKU (HDD before SSD).
  const sortedByLowerSku = [...candidates].sort((a, b) => {
    const aRank = rankMap[a.id] ?? Number.MAX_SAFE_INTEGER;
    const bRank = rankMap[b.id] ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });

  // Start from lower SKU and escalate only when it is Not Ready.
  const firstReadyOrConditional = sortedByLowerSku.find((outcome) => {
    const readinessState = readinessByOutcomeId.get(outcome.id)?.readinessState ?? "Not Ready";
    return readinessState !== "Not Ready";
  });

  return firstReadyOrConditional ?? sortedByLowerSku[0];
}

function formatMetricValue(value) {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "N/A";
}

function mergeReasonLists(primaryReasons = [], additionalReasons = []) {
  return [...new Set([...(primaryReasons || []), ...(additionalReasons || [])])];
}

function getReadinessBadgeClass(readinessState) {
  if (readinessState === "Ready") return "readiness-badge readiness-badge-ready";
  if (readinessState === "Ready with Condition") return "readiness-badge readiness-badge-condition";
  return "readiness-badge readiness-badge-not-ready";
}

function getComparisonBadgeClass(status) {
  if (status === "Match") return "comparison-badge comparison-badge-match";
  if (status === "Preferred Override") return "comparison-badge comparison-badge-override";
  return "comparison-badge comparison-badge-nomapping";
}

function isToggleEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function getTrackBVisibilityFlag() {
  const envEnabled = isToggleEnabled(import.meta.env.VITE_SHOW_TRACK_B);

  if (typeof window === "undefined") {
    return envEnabled;
  }

  const queryValue = new URLSearchParams(window.location.search).get("trackB");
  if (queryValue !== null) {
    return isToggleEnabled(queryValue);
  }

  return envEnabled;
}

function evaluateOutcomeReadiness({
  outcome,
  answers,
  trackMode,
  preferredOverrideOutcomeIds,
  selectedRegion,
  selectedRedundancy,
  allowedByService,
  sourceHasSmb,
  sourceHasS3,
  sourceHasNfs,
  sourceHasNfsV3,
  sourceHasNfsV41,
  blobProtocolSupported,
  filesProtocolSupported,
  effectiveBlobAccessFrequency,
  blobTierRegionAdjustment,
  selectedFilesMediaOutcomes,
  filesPerformanceEligibility,
  filesSkuRegionAdjustment,
  redundancyLabelMap,
  blobTierLabelMap,
  filesSkuLabelMap,
  protocolAdaptationMode = false,
  s3FilesCrossAssessmentMode = false,
}) {
  if (!allowedByService.has(outcome.id)) return null;

  const blockers = [];
  const conditions = [];
  const isBlobOutcome = blobOutcomeIds.includes(outcome.id);
  const isFilesOutcome = filesOutcomeIds.includes(outcome.id);
  const isTrackBPreferredOverride =
    trackMode === "B" && preferredOverrideOutcomeIds?.has(outcome.id);

  if (selectedRegion && !isAvailableInRegion(outcome.id, selectedRegion)) {
    blockers.push(`Not available in selected region ${selectedRegion}.`);
  }

  if (isBlobOutcome) {
    conditions.push(
      "Application/API adaptation is required for Azure Blob adoption, so Blob tiers are marked as Ready with Condition when otherwise eligible."
    );

    if (!blobProtocolSupported) {
      if (protocolAdaptationMode) {
        conditions.push(
          "Source protocol is not Blob-compatible by default; protocol/application adaptation is required (S3 or NFS v3 access path)."
        );
      } else {
        blockers.push(
          "Source protocol path is not supported by Azure Blob for this assessment (Blob path supports S3 and NFS v3)."
        );
      }
    }

    if (effectiveBlobAccessFrequency) {
      const requestedBlobOutcomeId = blobTierMap[effectiveBlobAccessFrequency];
      const effectiveBlobOutcomeId = blobTierRegionAdjustment?.applied ?? requestedBlobOutcomeId;

      if (outcome.id !== effectiveBlobOutcomeId) {
        const effectiveTierLabel = blobTierLabelMap[effectiveBlobOutcomeId] ?? effectiveBlobOutcomeId;
        if (isTrackBPreferredOverride) {
          conditions.push(
            `Preferred-choice override selected this Blob tier instead of the default effective tier (${effectiveTierLabel}).`
          );
        } else {
          blockers.push(
            `This tier is not the effective Blob tier for the current assessment (effective tier: ${effectiveTierLabel}).`
          );
        }
      }

      if (
        blobTierRegionAdjustment
        && outcome.id === effectiveBlobOutcomeId
        && blobTierRegionAdjustment.requested !== blobTierRegionAdjustment.applied
      ) {
        conditions.push(
          `Requested Blob ${blobTierLabelMap[blobTierRegionAdjustment.requested]} tier is unavailable in ${selectedRegion}, so ${blobTierLabelMap[blobTierRegionAdjustment.applied]} tier is used.`
        );
      }
    }
  }

  if (isFilesOutcome) {
    if (!filesProtocolSupported) {
      if (protocolAdaptationMode || s3FilesCrossAssessmentMode) {
        conditions.push(
          "Source protocol is not Azure Files-compatible by default; protocol/application adaptation is required (SMB or NFS v4.1)."
        );
      } else {
        blockers.push(
          "Source protocol path is not supported by Azure Files for this assessment (Files path supports SMB and NFS v4.1)."
        );
      }
    }

    if (sourceHasNfsV3 && !sourceHasNfsV41 && !sourceHasSmb) {
      if (protocolAdaptationMode || s3FilesCrossAssessmentMode) {
        conditions.push("NFS v3-only path requires protocol/application adaptation to SMB or NFS v4.1 for Azure Files.");
      } else {
        blockers.push("NFS v3-only protocol path is not supported by Azure Files.");
      }
    }

    if (!filesPerformanceEligibility.allowedOutcomeIds.includes(outcome.id)) {
      if (filesPerformanceEligibility.scenario === "none") {
        blockers.push(
          `Source scale/performance exceeds Azure Files suitability thresholds (size > ${formatMetricValue(filesPerformanceEligibility.thresholds.maxShareSizeGb)} GB or IOPS > ${formatMetricValue(filesPerformanceEligibility.thresholds.filesMaxIops)} or throughput > ${formatMetricValue(filesPerformanceEligibility.thresholds.filesMaxThroughputMibps)} MiB/s).`
        );
      } else if (filesPerformanceEligibility.scenario === "ssd-only" && outcome.id === "files-standard-hdd") {
        blockers.push(
          `Source performance falls in SSD-only range (${formatMetricValue(filesPerformanceEligibility.thresholds.hddMaxIops)} < IOPS < ${formatMetricValue(filesPerformanceEligibility.thresholds.filesMaxIops)} and ${formatMetricValue(filesPerformanceEligibility.thresholds.hddMaxThroughputMibps)} < throughput < ${formatMetricValue(filesPerformanceEligibility.thresholds.filesMaxThroughputMibps)} MiB/s), so Standard HDD is not suitable and remains Not Ready even when preferred-choice override is present.`
        );
      }
    }

    if (sourceHasNfs && outcome.id === "files-standard-hdd") {
      if (protocolAdaptationMode || s3FilesCrossAssessmentMode) {
        conditions.push("Azure Files Standard HDD requires SMB or NFS v4.1 compatible access behavior.");
      } else {
        blockers.push("Azure Files Standard HDD is not supported for NFS protocol paths.");
      }
    }

    if (
      selectedFilesMediaOutcomes.length > 0
      && !selectedFilesMediaOutcomes.includes(outcome.id)
    ) {
      if (isTrackBPreferredOverride) {
        conditions.push("Preferred-choice override selected a Files SKU outside the current media preference filter.");
      } else {
        blockers.push("Excluded by selected Azure Files media type preference.");
      }
    }

    if ((filesSkuRegionAdjustment?.fallbackOutcomeIds ?? []).includes(outcome.id)) {
      const substitutionForOutcome = (filesSkuRegionAdjustment?.substitutions ?? []).find(
        (item) => item.applied === outcome.id
      );
      if (substitutionForOutcome) {
        conditions.push(
          `Selected Files SKU ${filesSkuLabelMap[substitutionForOutcome.requested]} is region-unavailable; using ${filesSkuLabelMap[substitutionForOutcome.applied]} instead.`
        );
      }
    }
  }

  if (selectedRedundancy) {
    const redundancyAdjustment = getOutcomeRedundancyAdjustment(answers, outcome.id);
    if (!redundancyAdjustment) {
      blockers.push(
        `Requested redundancy ${redundancyLabelMap[selectedRedundancy] ?? selectedRedundancy} is unsupported for this SKU/tier and no fallback redundancy is available.`
      );
    } else if (redundancyAdjustment.requested !== redundancyAdjustment.applied) {
      conditions.push(
        `Redundancy adjusted from ${redundancyLabelMap[redundancyAdjustment.requested]} to ${redundancyLabelMap[redundancyAdjustment.applied]} for compatibility.`
      );
    }
  }

  if (outcome.rules && outcome.rules.length > 0) {
    const matchesRules = outcome.rules.some((ruleSet) =>
      Object.entries(ruleSet).every(
        ([questionId, requiredValue]) => answers[questionId] === requiredValue
      )
    );
    if (!matchesRules) {
      blockers.push("Does not satisfy outcome-specific support rules for the selected source profile.");
    }
  }

  if (isFilesOutcome && sourceHasS3 && (sourceHasSmb || sourceHasNfsV41)) {
    conditions.push(
      "Mixed protocol path detected: Azure Files readiness applies only to SMB/NFS v4.1 portions; S3 portion is assessed on Azure Blob."
    );
  }

  if (isFilesOutcome && sourceHasNfsV3 && (sourceHasNfsV41 || sourceHasSmb)) {
    conditions.push(
      "Mixed protocol path detected: Azure Files readiness applies only to SMB/NFS v4.1 portions; NFS v3 portion is assessed on Azure Blob."
    );
  }

  if (isBlobOutcome && (sourceHasS3 || sourceHasNfsV3) && (sourceHasSmb || sourceHasNfsV41)) {
    conditions.push(
      "Mixed protocol path detected: Azure Blob readiness applies only to S3/NFS v3 portions; SMB/NFS v4.1 portions are assessed on Azure Files."
    );
  }

  const dedupedBlockers = [...new Set(blockers)];
  const dedupedConditions = [...new Set(conditions)];

  const readinessState = dedupedBlockers.length > 0
    ? "Not Ready"
    : dedupedConditions.length > 0
      ? "Ready with Condition"
      : "Ready";

  const readinessReasons = readinessState === "Ready"
    ? ["All evaluated checks passed with no active conditions."]
    : [...dedupedBlockers, ...dedupedConditions];

  return {
    readinessState,
    readinessReasons,
  };
}

function getBlobRecommendationReasons({
  answers,
  bestBlobOutcome,
  eligibleBlobOutcomes,
  autoIncludedBlobForProtocolPriority,
  blobTierRegionAdjustment,
  blobTierLabelMap,
  redundancyLabelMap,
  getOutcomeRedundancyAdjustment,
}) {
  const sourceProtocolValues = Array.isArray(answers?.sourceProtocol)
    ? answers.sourceProtocol.map((value) => String(value).toLowerCase())
    : [String(answers?.sourceProtocol ?? "").toLowerCase()];
  const sourceProtocolJoined = sourceProtocolValues.join(",");
  const sourceHasS3 = sourceProtocolValues.includes("s3") || sourceProtocolJoined.includes("s3");
  const sourceHasNfsV3 = sourceProtocolValues.includes("nfs_v3") || sourceProtocolJoined.includes("nfs_v3");
  const sourceHasNfsV41 = sourceProtocolValues.includes("nfs_v41") || sourceProtocolJoined.includes("nfs_v41");
  const sourceHasSmb =
    sourceProtocolValues.includes("smb_v2")
    || sourceProtocolValues.includes("smb_v3")
    || sourceProtocolJoined.includes("smb");
  const filesComparableProtocolsPresent = sourceHasSmb || sourceHasNfsV41;

  if (!bestBlobOutcome) {
    const reasons = [
      "Azure Blob was selected, but no Blob access tier is currently eligible after applying protocol, region and redundancy checks.",
    ];

    if (!sourceHasS3 && !sourceHasNfsV3) {
      reasons.push(
        "Selected source protocol path is not Blob-supported for this assessment. Azure Blob evaluation path supports S3 and NFS v3; SMB and NFS v4.1 are evaluated through Azure Files."
      );
    }

    if ((sourceHasS3 || sourceHasNfsV3) && filesComparableProtocolsPresent) {
      reasons.push(
        "Mixed protocol selection detected. Blob applies only to S3/NFS v3 portions, while SMB/NFS v4.1 portions are evaluated through Azure Files."
      );
    }

    return reasons;
  }

  const reasons = [];
  const requestedBlobTier = answers?.blobAccessFrequency;
  const effectiveRequestedBlobTier = requestedBlobTier
    ?? (autoIncludedBlobForProtocolPriority ? "hot" : null);
  const requestedBlobTierOutcome = effectiveRequestedBlobTier
    ? `blob-${effectiveRequestedBlobTier}`
    : null;
  const redundancyAdjustment = getOutcomeRedundancyAdjustment(answers, bestBlobOutcome.id);

  if (autoIncludedBlobForProtocolPriority) {
    reasons.push(
      "Source protocol includes S3 and/or NFS v3, so Azure Blob was automatically included for that protocol path assessment."
    );
  } else {
    reasons.push("Azure Blob was selected as a target service, so Blob access tiers were evaluated.");
  }

  if (sourceHasS3 && sourceHasNfsV3) {
    reasons.push(
      "Blob is explicitly assessing S3 and NFS v3 protocol portions, which are treated as Blob-supported protocol paths and not handled by Azure Files."
    );
  } else if (sourceHasS3) {
    reasons.push(
      "Blob is explicitly assessing the S3 protocol portion, which is treated as a Blob-supported protocol path and not handled by Azure Files."
    );
  } else if (sourceHasNfsV3) {
    reasons.push(
      "Blob is explicitly assessing the NFS v3 protocol portion, which is treated as a Blob-supported protocol path and not handled by Azure Files."
    );
  }

  if ((sourceHasS3 || sourceHasNfsV3) && filesComparableProtocolsPresent) {
    reasons.push(
      "For mixed protocol selections, Blob recommendation applies to S3/NFS v3 portions while Azure Files recommendation applies to SMB/NFS v4.1 portions."
    );
  }

  if (requestedBlobTierOutcome && blobTierRegionAdjustment?.requested === requestedBlobTierOutcome) {
    reasons.push(
      `Requested access tier ${blobTierLabelMap[blobTierRegionAdjustment.requested]} is unavailable in ${answers?.region}, so the nearest warmer eligible tier ${blobTierLabelMap[blobTierRegionAdjustment.applied]} was selected.`
    );
  } else if (effectiveRequestedBlobTier) {
    const tierLabel = blobTierLabelMap[`blob-${effectiveRequestedBlobTier}`] ?? effectiveRequestedBlobTier;
    if (autoIncludedBlobForProtocolPriority && !requestedBlobTier) {
      reasons.push("Azure Blob Hot is applied as default for S3/NFS v3 protocol-path compatibility.");
    } else {
      reasons.push(
        `Requested access frequency maps to Blob ${tierLabel} and it is eligible in ${answers?.region}.`
      );
    }
  }

  if (redundancyAdjustment) {
    if (redundancyAdjustment.requested === redundancyAdjustment.applied) {
      reasons.push(
        `Requested redundancy ${redundancyLabelMap[redundancyAdjustment.requested]} is supported for this tier.`
      );
    } else {
      reasons.push(
        `Requested redundancy ${redundancyLabelMap[redundancyAdjustment.requested]} is not supported for this tier, so ${redundancyLabelMap[redundancyAdjustment.applied]} was applied.`
      );
    }
  }

  if (eligibleBlobOutcomes.length > 1) {
    reasons.push(
      "More than one Blob tier was eligible; the best tier was chosen using precedence Hot > Cool > Cold > Archive."
    );
  } else {
    reasons.push("This is the only Blob access tier that remained eligible after all checks.");
  }

  return reasons;
}

function getFilesRecommendationReasons({
  answers,
  bestFilesOutcome,
  eligibleFilesOutcomes,
  preferredChoiceOverrideApplies,
  preferLowerSkuFirst = false,
  s3FilesCrossAssessmentMode = false,
  filesSkuRegionAdjustment,
  filesPerformanceEligibility,
  filesSkuLabelMap,
  redundancyLabelMap,
  getOutcomeRedundancyAdjustment,
}) {
  const sourceProtocolValues = Array.isArray(answers?.sourceProtocol)
    ? answers.sourceProtocol.map((value) => String(value).toLowerCase())
    : [String(answers?.sourceProtocol ?? "").toLowerCase()];
  const sourceProtocol = sourceProtocolValues.join(",");
  const sourceHasSmb = sourceProtocol.includes("smb");
  const sourceHasNfs = sourceProtocol.includes("nfs");
  const sourceHasNfsV3 = sourceProtocol.includes("nfs_v3");
  const sourceHasNfsV41 = sourceProtocol.includes("nfs_v41");
  const sourceHasS3 = sourceProtocol.includes("s3");
  const filesPerfMetrics = filesPerformanceEligibility?.metrics ?? {};
  const filesPerfThresholds = filesPerformanceEligibility?.thresholds ?? {};
  const metricsSummary = `${formatMetricValue(filesPerfMetrics.shareSizeGb)} GB, ${formatMetricValue(filesPerfMetrics.iops)} IOPS, ${formatMetricValue(filesPerfMetrics.throughputMibps)} MiB/s`;
  const s3CrossAssessmentReason = 
    "NetApp ONTAP AFF and NetApp ONTAP FAS NAS appliances are a File system based architecture that exposes various shares supporting multiple protocols including NFS v3 and S3. Hence NFS v3 and S3 shares are also assessed as another shares against Azure Files and performance and scale targets were applied. In some scenarios, customers can also implement sharding on Azure Files shares to meet scalability requirements across file shares.";

  if (!bestFilesOutcome) {
    const reasons = [
      "Azure Files was selected, but no Files SKU is currently eligible after applying protocol, performance/scale, region and redundancy checks.",
    ];

    if (s3FilesCrossAssessmentMode) {
      reasons.push(s3CrossAssessmentReason);
    }

    if ((sourceHasNfsV3 || sourceHasS3) && !sourceHasNfsV41 && !sourceHasSmb) {
      reasons.push(
        "No Files SKU is eligible for the source protocol path. S3 and NFS v3 are assessed through Azure Blob (Hot by default when auto-included)."
      );
    }

    if (filesPerformanceEligibility?.scenario === "none") {
      reasons.push(
        `Source size/IOPS/throughput (${metricsSummary}) exceed Azure Files suitability limits (> ${formatMetricValue(filesPerfThresholds.maxShareSizeGb)} GB or > ${formatMetricValue(filesPerfThresholds.filesMaxIops)} IOPS or > ${formatMetricValue(filesPerfThresholds.filesMaxThroughputMibps)} MiB/s), so no Azure Files SKU is eligible.`
      );
    }

    return reasons;
  }

  const reasons = [];
  const selectedMediaTypes = Array.isArray(answers?.filesMediaType)
    ? answers.filesMediaType
    : answers?.filesMediaType
      ? [answers.filesMediaType]
      : [];
  const selectedMediaTypeSet = new Set(selectedMediaTypes);
  const assessesBothFilesSkusByDefault =
    selectedMediaTypeSet.has("ssd") && selectedMediaTypeSet.has("hdd");
  const redundancyAdjustment = getOutcomeRedundancyAdjustment(answers, bestFilesOutcome.id);
  const substitutionForBest = (filesSkuRegionAdjustment?.substitutions ?? []).find(
    (sub) => sub.applied === bestFilesOutcome.id
  );

  reasons.push("Azure Files was selected as a target service, so Azure Files SKUs were evaluated.");

  if (s3FilesCrossAssessmentMode) {
    reasons.push(s3CrossAssessmentReason);
  }

  if (filesPerformanceEligibility?.scenario === "both") {
    reasons.push(
      `Source size/IOPS/throughput (${metricsSummary}) are within baseline limits (< ${formatMetricValue(filesPerfThresholds.maxShareSizeGb)} GB, < ${formatMetricValue(filesPerfThresholds.hddMaxIops)} IOPS, < ${formatMetricValue(filesPerfThresholds.hddMaxThroughputMibps)} MiB/s), so both Azure Files Standard HDD and Premium SSD are suitable.`
    );
  } else if (filesPerformanceEligibility?.scenario === "ssd-only") {
    reasons.push(
      `Source size/IOPS/throughput (${metricsSummary}) exceed at least one HDD threshold while remaining within SSD thresholds (size < ${formatMetricValue(filesPerfThresholds.maxShareSizeGb)} GB, IOPS < ${formatMetricValue(filesPerfThresholds.filesMaxIops)}, throughput < ${formatMetricValue(filesPerfThresholds.filesMaxThroughputMibps)} MiB/s), so only Azure Files Premium SSD remains eligible.`
    );
  }

  if (substitutionForBest) {
    reasons.push(
      `Selected Files SKU ${filesSkuLabelMap[substitutionForBest.requested]} is unavailable in ${answers?.region}; switched to eligible alternative ${filesSkuLabelMap[substitutionForBest.applied]}.`
    );
  } else if (sourceHasNfs && !s3FilesCrossAssessmentMode) {
    reasons.push(
      "NFS source protocol was detected. Azure Files Standard HDD is not supported for NFS, so Premium SSD is selected when eligible."
    );
  } else if (selectedMediaTypes.length > 0 && !assessesBothFilesSkusByDefault) {
    reasons.push(
      `Selected media type filter (${selectedMediaTypes.map((m) => m.toUpperCase()).join(", ")}) allows this SKU to remain eligible.`
    );
  } else if (assessesBothFilesSkusByDefault) {
    reasons.push(
      "Azure Files media selection was not constrained; both Premium SSD and Standard HDD were assessed by default."
    );
  }

  if (sourceHasNfs && !s3FilesCrossAssessmentMode) {
    reasons.push(
      "NFS source protocol detected: Azure Files Standard HDD is excluded, so only Premium SSD remains eligible for Azure Files."
    );
  }

  if (sourceHasNfsV3 && (sourceHasNfsV41 || sourceHasSmb)) {
    reasons.push(
      "NFS v3 portion is assessed through Azure Blob Hot; Azure Files recommendation applies to the SMB/NFS v4.1 compatible protocol portion."
    );
  }

  if (sourceHasS3 && (sourceHasSmb || sourceHasNfsV41)) {
    reasons.push(
      "S3 protocol portion is assessed through Azure Blob; Azure Files recommendation applies to the SMB/NFS v4.1 compatible protocol portion."
    );
  }

  if (redundancyAdjustment) {
    if (redundancyAdjustment.requested === redundancyAdjustment.applied) {
      reasons.push(
        `Requested redundancy ${redundancyLabelMap[redundancyAdjustment.requested]} is supported for this SKU.`
      );
    } else {
      reasons.push(
        `Requested redundancy ${redundancyLabelMap[redundancyAdjustment.requested]} is not supported for this SKU, so ${redundancyLabelMap[redundancyAdjustment.applied]} was applied.`
      );
    }
  }

  if (eligibleFilesOutcomes.length > 1) {
    if (preferredChoiceOverrideApplies) {
      reasons.push(
        "Both Azure Files SKUs are suitable in this scenario; Track B applies preferred-choice mapping, so preferred SKU selection prevails and Premium SSD > Standard HDD precedence is not applied."
      );
    } else if (preferLowerSkuFirst) {
      reasons.push(
        "Multiple Azure Files SKUs are suitable. Recommendation starts from the lowest suitable SKU (Standard HDD) and escalates to Premium SSD only when the lower SKU is Not Ready for current performance/suitability checks."
      );
      reasons.push(
        "In the real application, when both SKU are ready and has equal weight, the cost effective one will be displayed to the user."
      );
    } else {
      reasons.push(
        "Both Azure Files SKUs were eligible; the best SKU was chosen using precedence Premium SSD > Standard HDD."
      );
    }
  } else {
    reasons.push("This is the only Azure Files SKU that remained eligible after all checks.");
  }

  return reasons;
}

export default function Results({
  outcomes,
  trackBOutcomes,
  trackBPreferredByService,
  trackBPreferredRow,
  trackBCanonicalProtocol,
  trackBMatchedPreferredToTrackA,
  allOutcomes,
  answers,
  questions,
  onRestart,
}) {
  const eligibleOutcomes = Array.isArray(outcomes) ? outcomes : [];
  const outcomeCatalog = Array.isArray(allOutcomes) && allOutcomes.length > 0
    ? allOutcomes
    : eligibleOutcomes;

  // Show a notice only if the user explicitly selected ANF as a target service
  // but it was blocked by region availability.
  const selectedAnf = answers?.targetService?.includes("anf");
  const anfRegionExcluded =
    selectedAnf &&
    answers?.region &&
    !isAvailableInRegion("anf-default", answers.region);

  const blobTierRegionAdjustment = getBlobTierRegionAdjustment(answers);
  const filesPv2RegionAvailability = getFilesPv2RegionAvailability(answers);
  const filesSkuRegionAdjustment = getFilesSkuRegionAdjustment(answers);
  const filesPerformanceEligibility = getFilesPerformanceSkuEligibility(answers);
  const redundancyLabelMap = {
    lrs: "LRS",
    zrs: "ZRS",
    grs: "GRS",
    gzrs: "GZRS",
  };
  const blobTierLabelMap = {
    "blob-hot": "Hot",
    "blob-cool": "Cool",
    "blob-cold": "Cold",
    "blob-archive": "Archive",
  };
  const filesSkuLabelMap = {
    "files-premium-ssd": "Azure Files Premium SSD (Pv2)",
    "files-standard-hdd": "Azure Files Standard HDD (Pv2)",
  };
  const blobOutcomeRank = {
    "blob-hot": 4,
    "blob-cool": 3,
    "blob-cold": 2,
    "blob-archive": 1,
  };
  const filesOutcomeRank = {
    "files-premium-ssd": 2,
    "files-standard-hdd": 1,
  };
  const blobOutcomeSet = new Set(Object.keys(blobTierLabelMap));
  const filesOutcomeSet = new Set(Object.keys(filesSkuLabelMap));

  const selectedServices = Array.isArray(answers?.targetService) ? answers.targetService : [];
  const selectedRedundancy = answers?.redundancy;
  const sourceNas = String(answers?.nas ?? "").toLowerCase();
  const filesSelected = selectedServices.includes("files");
  const selectedProtocolValues = Array.isArray(answers?.sourceProtocol)
    ? answers.sourceProtocol.map((value) => String(value).toLowerCase())
    : answers?.sourceProtocol
      ? [String(answers.sourceProtocol).toLowerCase()]
      : [];
  const sourceProtocolJoined = selectedProtocolValues.join(",");
  const sourceHasSmb =
    selectedProtocolValues.includes("smb_v2")
    || selectedProtocolValues.includes("smb_v3")
    || sourceProtocolJoined.includes("smb");
  const sourceHasS3 = selectedProtocolValues.includes("s3") || sourceProtocolJoined.includes("s3");
  const sourceHasNfsV3 = selectedProtocolValues.includes("nfs_v3") || sourceProtocolJoined.includes("nfs_v3");
  const sourceHasNfsV41 = selectedProtocolValues.includes("nfs_v41") || sourceProtocolJoined.includes("nfs_v41");
  const sourceHasNfs = sourceHasNfsV3 || sourceHasNfsV41 || sourceProtocolJoined.includes("nfs");
  const blobsSelected = selectedServices.includes("blobs");
  const s3FilesCrossAssessmentEnabled =
    (sourceHasS3 || sourceHasNfsV3) && (sourceNas === "netapp" || sourceNas === "dell");
  const autoIncludedFilesForS3CrossAssessment =
    blobsSelected && s3FilesCrossAssessmentEnabled && !filesSelected;
  const effectiveFilesSelected = filesSelected || autoIncludedFilesForS3CrossAssessment;
  const blobProtocolSupported = sourceHasS3 || sourceHasNfsV3;
  const filesProtocolSupported = sourceHasSmb || sourceHasNfsV41 || s3FilesCrossAssessmentEnabled;
  const autoIncludedBlobForProtocolPriority =
    filesSelected && (sourceHasNfsV3 || sourceHasS3) && !blobsSelected;
  const effectiveServices = autoIncludedBlobForProtocolPriority
    ? [...new Set([...selectedServices, "blobs"])]
    : selectedServices;
  const effectiveServicesWithFiles = autoIncludedFilesForS3CrossAssessment
    ? [...new Set([...effectiveServices, "files"])]
    : effectiveServices;
  const effectiveBlobAccessFrequency = answers?.blobAccessFrequency
    ?? (autoIncludedBlobForProtocolPriority ? "hot" : null);
  const effectiveBlobsSelected = blobsSelected || autoIncludedBlobForProtocolPriority;
  const showRecommendedSection = effectiveFilesSelected || effectiveBlobsSelected;
  const showTrackB = getTrackBVisibilityFlag();
  const maximizeReadinessAcrossTargets = answers?.maximizeReadinessAcrossTargets !== false;
  const prioritizeFilesBeforeBlob = sourceNas === "netapp" || sourceNas === "dell";

  const allowedByService = new Set(effectiveServicesWithFiles.flatMap((svc) => serviceOutcomeMap[svc] ?? []));
  const evaluatedOutcomes = outcomeCatalog.filter((outcome) => allowedByService.has(outcome.id));
  const outcomeById = new Map(outcomeCatalog.map((outcome) => [outcome.id, outcome]));

  function sortOutcomeCards(outcomeList) {
    if (!prioritizeFilesBeforeBlob) return outcomeList;

    const hasFiles = outcomeList.some((item) => filesOutcomeSet.has(item.id));
    const hasBlob = outcomeList.some((item) => blobOutcomeSet.has(item.id));
    if (!hasFiles || !hasBlob) return outcomeList;

    return [...outcomeList].sort((a, b) => {
      const aOrder = filesOutcomeSet.has(a.id) ? 0 : blobOutcomeSet.has(a.id) ? 1 : 2;
      const bOrder = filesOutcomeSet.has(b.id) ? 0 : blobOutcomeSet.has(b.id) ? 1 : 2;
      return aOrder - bOrder;
    });
  }

  const shouldRenderFilesFirst = prioritizeFilesBeforeBlob && effectiveFilesSelected && effectiveBlobsSelected;

  const selectedFilesMediaOutcomes = answers?.filesMediaType
    ? filesSkuRegionAdjustment?.appliedOutcomeIds ?? toFilesOutcomeIds(answers.filesMediaType)
    : [];

  const trackBPreferredOverrideOutcomeIds = new Set();
  if (trackBMatchedPreferredToTrackA?.blob === false && trackBPreferredByService?.blob) {
    trackBPreferredOverrideOutcomeIds.add(trackBPreferredByService.blob);
  }
  if (trackBMatchedPreferredToTrackA?.files === false && trackBPreferredByService?.files) {
    trackBPreferredOverrideOutcomeIds.add(trackBPreferredByService.files);
  }

  const readinessByOutcomeId = new Map(
    evaluatedOutcomes.map((outcome) => {
      const readiness = evaluateOutcomeReadiness({
        outcome,
        answers,
        trackMode: "A",
        preferredOverrideOutcomeIds: new Set(),
        selectedRegion: answers?.region,
        selectedRedundancy,
        allowedByService,
        sourceHasSmb,
        sourceHasS3,
        sourceHasNfs,
        sourceHasNfsV3,
        sourceHasNfsV41,
        blobProtocolSupported,
        filesProtocolSupported,
        effectiveBlobAccessFrequency,
        blobTierRegionAdjustment,
        selectedFilesMediaOutcomes,
        filesPerformanceEligibility,
        filesSkuRegionAdjustment,
        redundancyLabelMap,
        blobTierLabelMap,
        filesSkuLabelMap,
        s3FilesCrossAssessmentMode: s3FilesCrossAssessmentEnabled && filesOutcomeSet.has(outcome.id),
      });
      return [outcome.id, readiness];
    })
  );

  const eligibleBlobOutcomes = eligibleOutcomes.filter((outcome) => blobOutcomeSet.has(outcome.id));
  const eligibleFilesOutcomes = eligibleOutcomes.filter((outcome) => filesOutcomeSet.has(outcome.id));
  const bestBlobOutcome = getBestOutcomeByRank(eligibleBlobOutcomes, blobOutcomeRank);
  const bestFilesOutcome = getFilesOutcomeByLowerSkuEscalation(
    eligibleFilesOutcomes,
    filesOutcomeRank,
    readinessByOutcomeId
  ) ?? getBestOutcomeByRank(eligibleFilesOutcomes, filesOutcomeRank);
  const bestBlobReadiness = bestBlobOutcome
    ? readinessByOutcomeId.get(bestBlobOutcome.id)
    : null;
  const bestFilesReadiness = bestFilesOutcome
    ? readinessByOutcomeId.get(bestFilesOutcome.id)
    : null;

  const trackBEligibleOutcomes = Array.isArray(trackBOutcomes) ? trackBOutcomes : [];
  const trackBOutcomeIdSet = new Set(trackBEligibleOutcomes.map((outcome) => outcome.id));
  if (trackBPreferredByService?.blob && allowedByService.has(trackBPreferredByService.blob)) {
    trackBOutcomeIdSet.add(trackBPreferredByService.blob);
  }
  if (trackBPreferredByService?.files && allowedByService.has(trackBPreferredByService.files)) {
    trackBOutcomeIdSet.add(trackBPreferredByService.files);
  }
  const trackBEvaluatedOutcomes = outcomeCatalog.filter((outcome) => trackBOutcomeIdSet.has(outcome.id));

  const trackBReadinessByOutcomeId = new Map(
    trackBEvaluatedOutcomes.map((outcome) => {
      const readiness = evaluateOutcomeReadiness({
        outcome,
        answers,
        trackMode: "B",
        preferredOverrideOutcomeIds: trackBPreferredOverrideOutcomeIds,
        selectedRegion: answers?.region,
        selectedRedundancy,
        allowedByService,
        sourceHasSmb,
        sourceHasS3,
        sourceHasNfs,
        sourceHasNfsV3,
        sourceHasNfsV41,
        blobProtocolSupported,
        filesProtocolSupported,
        effectiveBlobAccessFrequency,
        blobTierRegionAdjustment,
        selectedFilesMediaOutcomes,
        filesPerformanceEligibility,
        filesSkuRegionAdjustment,
        redundancyLabelMap,
        blobTierLabelMap,
        filesSkuLabelMap,
        s3FilesCrossAssessmentMode: s3FilesCrossAssessmentEnabled && filesOutcomeSet.has(outcome.id),
      });
      return [outcome.id, readiness];
    })
  );

  const trackBHasReadyOrConditionalOutcome = trackBEvaluatedOutcomes.some((outcome) => {
    const readiness = trackBReadinessByOutcomeId.get(outcome.id);
    return readiness && readiness.readinessState !== "Not Ready";
  });

  const orderedEvaluatedOutcomes = sortOutcomeCards(evaluatedOutcomes);
  const orderedTrackBEvaluatedOutcomes = sortOutcomeCards(trackBEvaluatedOutcomes);

  const trackBEligibleBlobOutcomes = trackBEligibleOutcomes.filter((outcome) => blobOutcomeSet.has(outcome.id));
  const trackBEligibleFilesOutcomes = trackBEligibleOutcomes.filter((outcome) => filesOutcomeSet.has(outcome.id));
  const trackBFallbackBlobOutcome = getBestOutcomeByRank(trackBEligibleBlobOutcomes, blobOutcomeRank);
  const trackBFallbackFilesOutcome = getBestOutcomeByRank(trackBEligibleFilesOutcomes, filesOutcomeRank);
  const preferredBlobOutcome = trackBPreferredByService?.blob
    ? outcomeById.get(trackBPreferredByService.blob)
    : null;
  const preferredFilesOutcome = trackBPreferredByService?.files
    ? outcomeById.get(trackBPreferredByService.files)
    : null;
  const trackBMultipleFilesEligible = trackBEligibleFilesOutcomes.length > 1;
  const trackBPreferredSsdOverrideApplies =
    trackBMultipleFilesEligible
    && preferredFilesOutcome?.id === "files-premium-ssd"
    && trackBEligibleFilesOutcomes.some((outcome) => outcome.id === "files-premium-ssd");
  const trackBRecommendedBlobOutcome = getBestOutcomeByReadinessThenRank(
    trackBEligibleBlobOutcomes,
    blobOutcomeRank,
    trackBReadinessByOutcomeId
  );
  const trackBRecommendedFilesOutcome = getBestOutcomeByReadinessThenRank(
    trackBEligibleFilesOutcomes,
    filesOutcomeRank,
    trackBReadinessByOutcomeId
  );
  const trackBRecommendedFilesOutcomeLowerFirst = getFilesOutcomeByLowerSkuEscalation(
    trackBEligibleFilesOutcomes,
    filesOutcomeRank,
    trackBReadinessByOutcomeId
  );
  const trackBBestBlobOutcome = trackBRecommendedBlobOutcome ?? preferredBlobOutcome ?? trackBFallbackBlobOutcome;
  const trackBBestFilesOutcome = trackBPreferredSsdOverrideApplies
    ? preferredFilesOutcome
    : trackBRecommendedFilesOutcomeLowerFirst
      ?? trackBRecommendedFilesOutcome
      ?? preferredFilesOutcome
      ?? trackBFallbackFilesOutcome;
  const trackBBestBlobReadiness = trackBBestBlobOutcome
    ? trackBReadinessByOutcomeId.get(trackBBestBlobOutcome.id)
    : null;
  const trackBBestFilesReadiness = trackBBestFilesOutcome
    ? trackBReadinessByOutcomeId.get(trackBBestFilesOutcome.id)
    : null;

  const blobRecommendationReasons = effectiveBlobsSelected
    ? getBlobRecommendationReasons({
        answers,
        bestBlobOutcome,
        eligibleBlobOutcomes,
        autoIncludedBlobForProtocolPriority,
        blobTierRegionAdjustment,
        blobTierLabelMap,
        redundancyLabelMap,
        getOutcomeRedundancyAdjustment,
      })
    : [];

  const filesRecommendationReasons = effectiveFilesSelected
    ? getFilesRecommendationReasons({
        answers,
        bestFilesOutcome,
        eligibleFilesOutcomes,
        preferredChoiceOverrideApplies: false,
        preferLowerSkuFirst: true,
        s3FilesCrossAssessmentMode: s3FilesCrossAssessmentEnabled,
        filesSkuRegionAdjustment,
        filesPerformanceEligibility,
        filesSkuLabelMap,
        redundancyLabelMap,
        getOutcomeRedundancyAdjustment,
      })
    : [];

  const trackBBlobRecommendationReasons = effectiveBlobsSelected
    ? getBlobRecommendationReasons({
        answers,
        bestBlobOutcome: trackBBestBlobOutcome,
        eligibleBlobOutcomes: trackBEligibleBlobOutcomes,
        autoIncludedBlobForProtocolPriority,
        blobTierRegionAdjustment,
        blobTierLabelMap,
        redundancyLabelMap,
        getOutcomeRedundancyAdjustment,
      })
    : [];

  const trackBFilesRecommendationReasons = effectiveFilesSelected
    ? getFilesRecommendationReasons({
        answers,
        bestFilesOutcome: trackBBestFilesOutcome,
        eligibleFilesOutcomes: trackBEligibleFilesOutcomes,
        preferredChoiceOverrideApplies: trackBPreferredSsdOverrideApplies,
        preferLowerSkuFirst: !trackBPreferredSsdOverrideApplies,
        s3FilesCrossAssessmentMode: s3FilesCrossAssessmentEnabled,
        filesSkuRegionAdjustment,
        filesPerformanceEligibility,
        filesSkuLabelMap,
        redundancyLabelMap,
        getOutcomeRedundancyAdjustment,
      })
    : [];

  if (trackBPreferredRow) {
    const matrixContext = `Preferred-choice matrix matched Workload type \"${trackBPreferredRow.workloadType}\" + Source protocol \"${trackBCanonicalProtocol || trackBPreferredRow.sourceProtocolLabel}\".`;
    if (effectiveBlobsSelected) trackBBlobRecommendationReasons.unshift(matrixContext);
    if (effectiveFilesSelected) trackBFilesRecommendationReasons.unshift(matrixContext);
  } else {
    const fallbackContext = "No preferred-choice matrix row matched this workload/protocol combination, so Track B fell back to Track A suitability logic.";
    if (effectiveBlobsSelected) trackBBlobRecommendationReasons.unshift(fallbackContext);
    if (effectiveFilesSelected) trackBFilesRecommendationReasons.unshift(fallbackContext);
  }

  if (trackBPreferredByService?.blob && bestBlobOutcome?.id) {
    if (trackBMatchedPreferredToTrackA?.blob === true) {
      trackBBlobRecommendationReasons.unshift("Track A and preferred-choice mapping are aligned for Blob recommendation.");
    } else if (trackBMatchedPreferredToTrackA?.blob === false) {
      trackBBlobRecommendationReasons.unshift("Track B mismatch detected against Track A for Blob; recommended outcome is now selected by readiness priority (Ready, then Ready with Condition), while preferred outcome remains listed in Track B SKU details.");
    }
  }

  if (trackBPreferredByService?.files && bestFilesOutcome?.id) {
    if (trackBMatchedPreferredToTrackA?.files === true) {
      trackBFilesRecommendationReasons.unshift("Track A and preferred-choice mapping are aligned for Azure Files recommendation.");
    } else if (trackBMatchedPreferredToTrackA?.files === false) {
      trackBFilesRecommendationReasons.unshift("Track B mismatch detected against Track A for Azure Files; recommended outcome is now selected by readiness priority (Ready, then Ready with Condition), while preferred outcome remains listed in Track B SKU details.");
    }
  }

  if (trackBPreferredSsdOverrideApplies) {
    trackBFilesRecommendationReasons.unshift(
      "Preferred-choice mapping explicitly recommends Azure Files Premium SSD for this workload/protocol combination. Since multiple Azure Files SKUs are eligible, Premium SSD is selected in Track B Recommended section."
    );
  }

  const trackABlobRecommendationReasonsFull = blobRecommendationReasons;
  const trackBBlobRecommendationReasonsFull = trackBBlobRecommendationReasons;
  const filesFallbackPairs = (filesSkuRegionAdjustment?.substitutions ?? [])
    .filter((item) => item.applied)
    .map((item) => `${filesSkuLabelMap[item.requested]} → ${filesSkuLabelMap[item.applied]}`);
  const filesFallbackOutcomeSet = new Set(filesSkuRegionAdjustment?.fallbackOutcomeIds ?? []);
  const hasFilesFallbackInResults = evaluatedOutcomes.some((outcome) => filesFallbackOutcomeSet.has(outcome.id));
  const filesServiceUnavailableInRegion =
    effectiveFilesSelected
    && !!filesPv2RegionAvailability
    && !filesPv2RegionAvailability.serviceAvailable;
  const filesPerformanceOutOfBounds =
    effectiveFilesSelected && filesPerformanceEligibility?.scenario === "none";
  const hasRedundancyDowngrade =
    !!selectedRedundancy
    && evaluatedOutcomes.some((outcome) => {
      const adjustment = getOutcomeRedundancyAdjustment(answers, outcome.id);
      return adjustment && adjustment.requested !== adjustment.applied;
    });
  const hasReadyOrConditionalOutcome = evaluatedOutcomes.some((outcome) => {
    const readiness = readinessByOutcomeId.get(outcome.id);
    return readiness && readiness.readinessState !== "Not Ready";
  });

  function getComparisonStatus(serviceKey) {
    const preferredOutcomeId = trackBPreferredByService?.[serviceKey];
    if (!preferredOutcomeId) return "No Mapping";
    if (trackBMatchedPreferredToTrackA?.[serviceKey] === true) return "Match";
    if (trackBMatchedPreferredToTrackA?.[serviceKey] === false) return "Preferred Override";
    return "No Mapping";
  }

  const blobComparisonStatus = effectiveBlobsSelected ? getComparisonStatus("blob") : null;
  const filesComparisonStatus = effectiveFilesSelected ? getComparisonStatus("files") : null;

  const allBlobOutcomeCandidates = outcomeCatalog.filter((outcome) => blobOutcomeSet.has(outcome.id));
  const allFilesOutcomeCandidates = outcomeCatalog.filter((outcome) => filesOutcomeSet.has(outcome.id));
  const allBlobAndFilesOutcomeIds = new Set([...blobOutcomeIds, ...filesOutcomeIds]);

  function getAlternativeReadinessMap(trackMode, preferredOverrideOutcomeIds) {
    return new Map(
      outcomeCatalog
        .filter((outcome) => allBlobAndFilesOutcomeIds.has(outcome.id))
        .map((outcome) => {
          const readiness = evaluateOutcomeReadiness({
            outcome,
            answers,
            trackMode,
            preferredOverrideOutcomeIds,
            selectedRegion: answers?.region,
            selectedRedundancy,
            allowedByService: allBlobAndFilesOutcomeIds,
            sourceHasSmb,
            sourceHasS3,
            sourceHasNfs,
            sourceHasNfsV3,
            sourceHasNfsV41,
            blobProtocolSupported,
            filesProtocolSupported,
            effectiveBlobAccessFrequency: effectiveBlobAccessFrequency ?? "hot",
            blobTierRegionAdjustment,
            selectedFilesMediaOutcomes,
            filesPerformanceEligibility,
            filesSkuRegionAdjustment,
            redundancyLabelMap,
            blobTierLabelMap,
            filesSkuLabelMap,
            protocolAdaptationMode: true,
          });
          return [outcome.id, readiness];
        })
    );
  }

  function pickBestFilesCandidate(candidates, readinessMap) {
    return getFilesOutcomeByLowerSkuEscalation(candidates, filesOutcomeRank, readinessMap)
      ?? getBestOutcomeByReadinessThenRank(candidates, filesOutcomeRank, readinessMap)
      ?? getBestOutcomeByRank(candidates, filesOutcomeRank);
  }

  function pickAlternativeOutcome({
    primaryBlobOutcome,
    primaryFilesOutcome,
    readinessMap,
  }) {
    const primaryIds = new Set([
      primaryBlobOutcome?.id,
      primaryFilesOutcome?.id,
    ].filter(Boolean));

    const blobAlternatives = allBlobOutcomeCandidates.filter((outcome) => !primaryIds.has(outcome.id));
    const filesAlternatives = allFilesOutcomeCandidates.filter((outcome) => !primaryIds.has(outcome.id));
    const viableBlobAlternatives = blobAlternatives.filter((outcome) => {
      const readinessState = readinessMap.get(outcome.id)?.readinessState ?? "Not Ready";
      return readinessState !== "Not Ready";
    });
    const viableFilesAlternatives = filesAlternatives.filter((outcome) => {
      const readinessState = readinessMap.get(outcome.id)?.readinessState ?? "Not Ready";
      return readinessState !== "Not Ready";
    });

    const preferBlobAlternative = !!primaryFilesOutcome && !primaryBlobOutcome;
    const preferFilesAlternative = !!primaryBlobOutcome && !primaryFilesOutcome;

    if (preferBlobAlternative) {
      return getBestOutcomeByReadinessThenRank(viableBlobAlternatives, blobOutcomeRank, readinessMap)
        ?? getBestOutcomeByRank(viableBlobAlternatives, blobOutcomeRank)
        ?? null;
    }

    if (preferFilesAlternative) {
      return pickBestFilesCandidate(viableFilesAlternatives, readinessMap) ?? null;
    }

    const bestBlobAlternative = getBestOutcomeByReadinessThenRank(viableBlobAlternatives, blobOutcomeRank, readinessMap)
      ?? getBestOutcomeByRank(viableBlobAlternatives, blobOutcomeRank)
      ?? null;
    const bestFilesAlternative = pickBestFilesCandidate(viableFilesAlternatives, readinessMap) ?? null;

    if (!bestBlobAlternative) return bestFilesAlternative;
    if (!bestFilesAlternative) return bestBlobAlternative;

    const blobReadinessPriority = getReadinessPriority(
      readinessMap.get(bestBlobAlternative.id)?.readinessState ?? "Not Ready"
    );
    const filesReadinessPriority = getReadinessPriority(
      readinessMap.get(bestFilesAlternative.id)?.readinessState ?? "Not Ready"
    );

    if (blobReadinessPriority !== filesReadinessPriority) {
      return blobReadinessPriority > filesReadinessPriority
        ? bestBlobAlternative
        : bestFilesAlternative;
    }

    const blobRank = blobOutcomeRank[bestBlobAlternative.id] ?? -1;
    const filesRank = filesOutcomeRank[bestFilesAlternative.id] ?? -1;
    return blobRank >= filesRank ? bestBlobAlternative : bestFilesAlternative;
  }

  function getAlternativeConditions(outcome, readiness) {
    if (!outcome) return [];

    const conditions = [
      "Readiness maximised is additive: this option is shown alongside the primary recommendation, not as a replacement.",
      "This option is always presented as Ready with Condition and requires workload/application replatforming or rearchitecture for the alternative Azure service.",
      "Complete protocol and application suitability fixes, then validate via POC before production migration.",
    ];

    if (blobOutcomeSet.has(outcome.id)) {
      conditions.push(
        "Blob alternative requires application behavior aligned to object storage semantics and access patterns."
      );
      if (!blobProtocolSupported) {
        conditions.push(
          "Current source protocol path is not Blob-compatible by default; adopt a Blob-compatible path (S3/NFS v3) or replatform/rearchitect accordingly."
        );
      }
    }

    if (filesOutcomeSet.has(outcome.id)) {
      conditions.push(
        "Azure Files alternative requires SMB or NFS v4.1 compatible client/application behavior."
      );
      if (!filesProtocolSupported) {
        conditions.push(
          "Current source protocol path is not Azure Files-compatible by default; update application/client behavior to SMB/NFS v4.1 before adoption."
        );
      }
      if (sourceHasNfsV3 && !sourceHasNfsV41 && !sourceHasSmb) {
        conditions.push(
          "NFS v3-only workloads require protocol/application changes to SMB or NFS v4.1 to use Azure Files."
        );
      }
    }

    if (answers?.region && !isAvailableInRegion(outcome.id, answers.region)) {
      conditions.push(
        `Selected region ${answers.region} does not currently support this option; choose a supported region or adjust your deployment architecture.`
      );
    }

    if (selectedRedundancy && !getOutcomeRedundancyAdjustment(answers, outcome.id)) {
      conditions.push(
        `Requested redundancy ${redundancyLabelMap[selectedRedundancy] ?? selectedRedundancy} is not supported for this option; select a compatible redundancy profile.`
      );
    }

    const readinessReasons = readiness?.readinessReasons ?? [];
    return mergeReasonLists(conditions, readinessReasons);
  }

  function getAlternativeRecommendationReasons({
    outcome,
    trackMode,
    preferredChoiceOverrideApplies = false,
  }) {
    if (!outcome) return [];

    const reasons = [
      "Included because Maximise readiness across target services is enabled.",
    ];

    if (blobOutcomeSet.has(outcome.id)) {
      return mergeReasonLists(
        reasons,
        getBlobRecommendationReasons({
          answers,
          bestBlobOutcome: outcome,
          eligibleBlobOutcomes: allBlobOutcomeCandidates,
          autoIncludedBlobForProtocolPriority,
          blobTierRegionAdjustment,
          blobTierLabelMap,
          redundancyLabelMap,
          getOutcomeRedundancyAdjustment,
        })
      );
    }

    if (filesOutcomeSet.has(outcome.id)) {
      return mergeReasonLists(
        reasons,
        getFilesRecommendationReasons({
          answers,
          bestFilesOutcome: outcome,
          eligibleFilesOutcomes: allFilesOutcomeCandidates,
          preferredChoiceOverrideApplies: trackMode === "B" ? preferredChoiceOverrideApplies : false,
          preferLowerSkuFirst: trackMode === "B" ? !preferredChoiceOverrideApplies : true,
          s3FilesCrossAssessmentMode: s3FilesCrossAssessmentEnabled,
          filesSkuRegionAdjustment,
          filesPerformanceEligibility,
          filesSkuLabelMap,
          redundancyLabelMap,
          getOutcomeRedundancyAdjustment,
        })
      );
    }

    return reasons;
  }

  const alternativeReadinessByOutcomeId = getAlternativeReadinessMap("A", new Set());
  const alternativeTrackAOutcome = maximizeReadinessAcrossTargets
    ? pickAlternativeOutcome({
        primaryBlobOutcome: bestBlobOutcome,
        primaryFilesOutcome: bestFilesOutcome,
        readinessMap: alternativeReadinessByOutcomeId,
      })
    : null;
  const alternativeTrackAReadiness = alternativeTrackAOutcome
    ? alternativeReadinessByOutcomeId.get(alternativeTrackAOutcome.id)
    : null;
  const alternativeTrackAConditions = maximizeReadinessAcrossTargets
    ? getAlternativeConditions(alternativeTrackAOutcome, alternativeTrackAReadiness)
    : [];
  const alternativeTrackARecommendationReasons = maximizeReadinessAcrossTargets
    ? getAlternativeRecommendationReasons({
        outcome: alternativeTrackAOutcome,
        trackMode: "A",
      })
    : [];

  const alternativeTrackBReadinessByOutcomeId = getAlternativeReadinessMap("B", trackBPreferredOverrideOutcomeIds);
  const alternativeTrackBOutcome = maximizeReadinessAcrossTargets
    ? pickAlternativeOutcome({
        primaryBlobOutcome: trackBBestBlobOutcome,
        primaryFilesOutcome: trackBBestFilesOutcome,
        readinessMap: alternativeTrackBReadinessByOutcomeId,
      })
    : null;
  const alternativeTrackBReadiness = alternativeTrackBOutcome
    ? alternativeTrackBReadinessByOutcomeId.get(alternativeTrackBOutcome.id)
    : null;
  const alternativeTrackBConditions = maximizeReadinessAcrossTargets
    ? getAlternativeConditions(alternativeTrackBOutcome, alternativeTrackBReadiness)
    : [];
  const alternativeTrackBRecommendationReasons = maximizeReadinessAcrossTargets
    ? getAlternativeRecommendationReasons({
        outcome: alternativeTrackBOutcome,
        trackMode: "B",
        preferredChoiceOverrideApplies: trackBPreferredSsdOverrideApplies,
      })
    : [];

  // Build the list of questions that were actually answered (visible questions only)
  const answeredQuestions = (questions ?? []).filter(
    (q) => answers[q.id] !== undefined
  );

  const protocolLabelMap = {
    smb_v2: "SMB v2.x",
    smb_v3: "SMB v3.x",
    nfs_v3: "NFS v3",
    nfs_v41: "NFS v4.1",
    s3: "S3",
  };

  const blobProtocolOutcomeSet = new Set(["blob-hot", "blob-cool", "blob-cold", "blob-archive"]);
  const filesProtocolOutcomeSet = new Set(["files-standard-hdd", "files-premium-ssd"]);
  const blobSupportedProtocols = ["s3", "nfs_v3"];
  const filesSupportedProtocols = ["smb_v2", "smb_v3", "nfs_v41"];

  function getSupportedProtocolLabelForOutcome(outcomeId) {
    const supportedValues = blobProtocolOutcomeSet.has(outcomeId)
      ? blobSupportedProtocols
      : filesProtocolOutcomeSet.has(outcomeId)
        ? filesSupportedProtocols
        : selectedProtocolValues;

    const valuesToShow = blobProtocolOutcomeSet.has(outcomeId)
      ? supportedValues
      : (() => {
          const selectedSupported = selectedProtocolValues.filter((value) => supportedValues.includes(value));
          return selectedSupported.length > 0 ? selectedSupported : supportedValues;
        })();
    const labels = valuesToShow.map((value) => protocolLabelMap[value] ?? value);
    return labels.length > 0 ? labels.join(", ") : "N/A";
  }

  return (
    <div className="card results-card">
      <h2 className="results-heading">
        {hasReadyOrConditionalOutcome
          ? "Here are your assessed options"
          : evaluatedOutcomes.length > 0
            ? "No Ready options found"
            : "No matches found"}
      </h2>

      {anfRegionExcluded && (
        <p className="region-notice">
          ⚠ Azure NetApp Files is not available in the selected region and has been excluded from results.
        </p>
      )}

      {hasRedundancyDowngrade && (
        <p className="region-notice">
          ⚠ The selected redundancy is not supported by some eligible SKUs. For compatibility, this assessment downgrades per SKU using GZRS → GRS → ZRS → LRS.
        </p>
      )}

      {blobTierRegionAdjustment && (
        <p className="region-notice">
          ⚠ Azure Blob {blobTierLabelMap[blobTierRegionAdjustment.requested]} tier is not available in the selected region. For compatibility, this assessment upgrades to {blobTierLabelMap[blobTierRegionAdjustment.applied]} tier.
        </p>
      )}

      {hasFilesFallbackInResults && (
        <p className="region-notice">
          ⚠ Selected Azure Files SKU is not available in the selected region. This assessment continued using an alternative Azure Files SKU: {filesFallbackPairs.join("; ")}. Please run a workload/application POC in the target region and validate performance/compatibility before finalizing migration.
        </p>
      )}

      {filesServiceUnavailableInRegion && (
        <p className="region-notice">
          ⚠ Azure Files Pv2 is not available in the selected region and has been excluded from results. Please select another region or target service.
        </p>
      )}

      {filesPerformanceOutOfBounds && (
        <p className="region-notice">
          ⚠ Source size/IOPS/throughput exceed Azure Files suitability limits for this assessment, so Azure Files SKUs were excluded from the result set.
        </p>
      )}

      {autoIncludedBlobForProtocolPriority && (
        <p className="region-notice">
          ⚠ Source protocol includes S3 and/or NFS v3. Azure Blob Hot tier has been automatically included for protocol-path assessment.
        </p>
      )}

      {autoIncludedFilesForS3CrossAssessment && (
        <p className="region-notice">
          ⚠ Source protocol includes NFS v3 and/or S3 from NetApp/Dell NAS. Azure Files has been additionally assessed (performance/scale validated) and is presented as Ready with Condition for protocol/application adaptation planning.
        </p>
      )}

      {/* Methodology callout */}
      <div className="callout-section">
        <ul className="callout-list">
          <li>
            <strong>Performance filtering:</strong> In a full assessment, this list is further refined based on discovered performance metrics (IOPS, throughput) and sizing considerations from your source environment.
          </li>
          <li>
            <strong>Readiness for all evaluated SKUs/tier:</strong> Every evaluated Azure Files SKU and Blob tier is shown below with a readiness state (<strong>Ready</strong>, <strong>Ready with Condition</strong>, or <strong>Not Ready</strong>) and explicit reasons.
          </li>
          <li>
            <strong>Ranking methodology:</strong> Source data is evaluated by protocol, version, and redundancy availability, then by performance and scalability metrics (with default inputs where applicable). Each SKU receives a relative suitability weight; where two SKUs score equally, cost is used as the tiebreaker.
          </li>
        </ul>
      </div>

      <div className={`track-columns${showTrackB ? "" : " single-track"}`}>
        <section className="track-panel" aria-label="Track A panel">
          {showRecommendedSection && (
            <section className="recommended-section" aria-label="Track A recommended services">
              <h3 className="recommended-heading">RECOMMENDED</h3>

              <div className="recommended-grid">
                {shouldRenderFilesFirst && effectiveFilesSelected && (
                  <article className="recommended-card">
                    <div className="recommended-title-row">
                      <h4 className="recommended-card-title">Best Eligible Azure Files SKU</h4>
                      {bestFilesReadiness && (
                        <span className={getReadinessBadgeClass(s3FilesCrossAssessmentEnabled ? "Ready with Condition" : bestFilesReadiness.readinessState)}>
                          {s3FilesCrossAssessmentEnabled ? "Ready with Condition" : bestFilesReadiness.readinessState}
                        </span>
                      )}
                    </div>
                    <p className="recommended-card-value">
                      {bestFilesOutcome ? bestFilesOutcome.title : "No eligible Azure Files SKU"}
                    </p>
                    {bestFilesReadiness && (
                      <>
                        <p className="recommended-card-readiness">
                          Readiness: {s3FilesCrossAssessmentEnabled ? "Ready with Condition" : bestFilesReadiness.readinessState}
                        </p>
                        {bestFilesReadiness.readinessReasons?.length > 0 && (
                          <>
                            <h5 className="recommended-card-subheading">Readiness reasons</h5>
                            <ul className="readiness-reasons-list">
                              {bestFilesReadiness.readinessReasons.map((reason, index) => (
                                <li key={`files-readiness-${index}`}>{reason}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                    <h5 className="recommended-card-subheading">Why was this SKU recommended?</h5>
                    <ol className="recommended-logic-list">
                      {filesRecommendationReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ol>
                    <button type="button" className="wave-plan-btn">Add to wave plan</button>
                  </article>
                )}

                {effectiveBlobsSelected && (
                  <article className="recommended-card">
                    <div className="recommended-title-row">
                      <h4 className="recommended-card-title">Best Eligible Azure Blob Access Tier</h4>
                      {bestBlobReadiness && (
                        <span className={getReadinessBadgeClass(bestBlobReadiness.readinessState)}>
                          {bestBlobReadiness.readinessState}
                        </span>
                      )}
                    </div>
                    <p className="recommended-card-value">
                      {bestBlobOutcome ? bestBlobOutcome.title : "No eligible Blob tier"}
                    </p>
                    {bestBlobReadiness && (
                      <>
                        <p className="recommended-card-readiness">
                          Readiness: {bestBlobReadiness.readinessState}
                        </p>
                        {bestBlobReadiness.readinessReasons?.length > 0 && (
                          <>
                            <h5 className="recommended-card-subheading">Readiness reasons</h5>
                            <ul className="readiness-reasons-list">
                              {bestBlobReadiness.readinessReasons.map((reason, index) => (
                                <li key={`blob-readiness-${index}`}>{reason}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                    <h5 className="recommended-card-subheading">Why was this access tier recommended?</h5>
                    <ol className="recommended-logic-list">
                      {trackABlobRecommendationReasonsFull.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ol>
                    <button type="button" className="wave-plan-btn">Add to wave plan</button>
                  </article>
                )}

                {!shouldRenderFilesFirst && effectiveFilesSelected && (
                  <article className="recommended-card">
                    <div className="recommended-title-row">
                      <h4 className="recommended-card-title">Best Eligible Azure Files SKU</h4>
                      {bestFilesReadiness && (
                        <span className={getReadinessBadgeClass(s3FilesCrossAssessmentEnabled ? "Ready with Condition" : bestFilesReadiness.readinessState)}>
                          {s3FilesCrossAssessmentEnabled ? "Ready with Condition" : bestFilesReadiness.readinessState}
                        </span>
                      )}
                    </div>
                    <p className="recommended-card-value">
                      {bestFilesOutcome ? bestFilesOutcome.title : "No eligible Azure Files SKU"}
                    </p>
                    {bestFilesReadiness && (
                      <>
                        <p className="recommended-card-readiness">
                          Readiness: {s3FilesCrossAssessmentEnabled ? "Ready with Condition" : bestFilesReadiness.readinessState}
                        </p>
                        {bestFilesReadiness.readinessReasons?.length > 0 && (
                          <>
                            <h5 className="recommended-card-subheading">Readiness reasons</h5>
                            <ul className="readiness-reasons-list">
                              {bestFilesReadiness.readinessReasons.map((reason, index) => (
                                <li key={`files-readiness-${index}`}>{reason}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                    <h5 className="recommended-card-subheading">Why was this SKU recommended?</h5>
                    <ol className="recommended-logic-list">
                      {filesRecommendationReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ol>
                    <button type="button" className="wave-plan-btn">Add to wave plan</button>
                  </article>
                )}
              </div>
            </section>
          )}

          {maximizeReadinessAcrossTargets && alternativeTrackAOutcome && (
            <section className="recommended-section" aria-label="Track A additional target option">
              <h3 className="recommended-heading">ADDITIONAL TARGET OPTION (MAXIMISE READINESS)</h3>
              <div className="recommended-grid">
                <article className="recommended-card">
                  <div className="recommended-title-row">
                    <h4 className="recommended-card-title">Additional cross-service option</h4>
                    <span className={getReadinessBadgeClass("Ready with Condition")}>Ready with Condition</span>
                    <span className="result-badge" aria-label="Readiness maximised">
                      Readiness maximised
                    </span>
                  </div>
                  <p className="recommended-card-value">{alternativeTrackAOutcome.title}</p>
                  <p className="recommended-card-readiness">Readiness: Ready with Condition</p>
                  {alternativeTrackAConditions.length > 0 && (
                    <>
                      <h5 className="recommended-card-subheading">Readiness reasons</h5>
                      <ul className="readiness-reasons-list">
                        {alternativeTrackAConditions.map((reason, index) => (
                          <li key={`tracka-alt-condition-${index}`}>{reason}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <h5 className="recommended-card-subheading">
                    {blobOutcomeSet.has(alternativeTrackAOutcome.id)
                      ? "Why was this access tier recommended?"
                      : "Why was this SKU recommended?"}
                  </h5>
                  <ol className="recommended-logic-list">
                    {alternativeTrackARecommendationReasons.map((reason, index) => (
                      <li key={`tracka-alt-reason-${index}`}>{reason}</li>
                    ))}
                  </ol>
                  <button type="button" className="wave-plan-btn">Add to wave plan</button>
                </article>
              </div>
            </section>
          )}

          {evaluatedOutcomes.length === 0 ? (
            <p className="no-results">
              Your answers didn't match any products in our current catalogue. Try
              adjusting your selections.
            </p>
          ) : (
            <details className="assessed-options-disclosure">
              <summary className="assessed-options-summary">Options that were assessed</summary>

              <div className="assessed-options-content">
                {!hasReadyOrConditionalOutcome && (
                  <p className="no-results">
                    All evaluated SKUs/tier are currently marked as Not Ready for the selected inputs.
                  </p>
                )}

                <ul className="results-list">
                  {orderedEvaluatedOutcomes.map((outcome) => {
                    const outcomeTier = getOutcomeTierLabel(outcome);
                    const redundancyAdjustment = getOutcomeRedundancyAdjustment(answers, outcome.id);
                    const effectiveRedundancy = redundancyAdjustment?.applied ?? answers?.redundancy;
                    const outcomeRedundancy =
                      redundancyLabelMap[effectiveRedundancy] ?? String(effectiveRedundancy ?? "N/A");
                    const readiness = readinessByOutcomeId.get(outcome.id);
                    const readinessState = readiness?.readinessState ?? "Not Ready";
                    const readinessReasons = readiness?.readinessReasons ?? ["No readiness details available."];

                    return (
                      <li key={outcome.id} className="result-item">
                        <div className="result-title-row">
                          <h3 className="result-title">{outcome.title}</h3>
                          <span className={getReadinessBadgeClass(readinessState)}>{readinessState}</span>
                          {redundancyAdjustment && redundancyAdjustment.requested !== redundancyAdjustment.applied && (
                            <span className="result-badge" aria-label="Redundancy adjusted for compatibility">
                              Redundancy downgraded to {redundancyLabelMap[redundancyAdjustment.applied]}
                            </span>
                          )}
                          {outcome.id === blobTierRegionAdjustment?.applied && (
                            <span className="result-badge" aria-label="Tier adjusted for regional availability">
                              Tier upgraded from {blobTierLabelMap[blobTierRegionAdjustment.requested]}
                            </span>
                          )}
                          {filesFallbackOutcomeSet.has(outcome.id) && (
                            <span className="result-badge" aria-label="Azure Files SKU adjusted for regional availability">
                              SKU switched due to regional availability
                            </span>
                          )}
                        </div>
                        <p className="result-meta">
                          Tier: {outcomeTier} | Redundancy: {outcomeRedundancy} | Protocol: {getSupportedProtocolLabelForOutcome(outcome.id)}
                        </p>
                        <ul className="readiness-reasons-list">
                          {readinessReasons.map((reason, index) => (
                            <li key={`${outcome.id}-reason-${index}`}>{reason}</li>
                          ))}
                        </ul>
                        <p className="result-description">{outcome.description}</p>
                        <button type="button" className="wave-plan-btn">Add to wave plan</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          )}
        </section>

        {showTrackB && (
          <section className="track-panel" aria-label="Track B panel">
            <h3 className="track-panel-heading">Track B — Workload suitability mapping and preference + Track A Suitability</h3>

          {showRecommendedSection && (
            <section className="recommended-section" aria-label="Track B preferred choice">
              <h3 className="recommended-heading">RECOMMENDED</h3>

              <div className="recommended-grid">
                {shouldRenderFilesFirst && effectiveFilesSelected && (
                  <article className="recommended-card">
                    <div className="recommended-title-row">
                      <h4 className="recommended-card-title">Best Eligible Azure Files SKU</h4>
                      {filesComparisonStatus && (
                        <span className={getComparisonBadgeClass(filesComparisonStatus)}>{filesComparisonStatus}</span>
                      )}
                    </div>
                    <p className="recommended-card-value">
                      {trackBBestFilesOutcome ? trackBBestFilesOutcome.title : "No eligible Azure Files SKU"}
                    </p>
                    {trackBBestFilesReadiness && (
                      <>
                        <p className="recommended-card-readiness">
                          Readiness: {s3FilesCrossAssessmentEnabled ? "Ready with Condition" : trackBBestFilesReadiness.readinessState}
                        </p>
                        {trackBBestFilesReadiness.readinessReasons?.length > 0 && (
                          <>
                            <h5 className="recommended-card-subheading">Readiness reasons</h5>
                            <ul className="readiness-reasons-list">
                              {trackBBestFilesReadiness.readinessReasons.map((reason, index) => (
                                <li key={`trackb-files-readiness-${index}`}>{reason}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                    <h5 className="recommended-card-subheading">Why was this SKU recommended?</h5>
                    <ol className="recommended-logic-list">
                      {trackBFilesRecommendationReasons.map((reason, index) => (
                        <li key={`trackb-files-reason-${index}`}>{reason}</li>
                      ))}
                    </ol>
                    <button type="button" className="wave-plan-btn">Add to wave plan</button>
                  </article>
                )}

                {effectiveBlobsSelected && (
                  <article className="recommended-card">
                    <div className="recommended-title-row">
                      <h4 className="recommended-card-title">Best Eligible Azure Blob Access Tier</h4>
                      {blobComparisonStatus && (
                        <span className={getComparisonBadgeClass(blobComparisonStatus)}>{blobComparisonStatus}</span>
                      )}
                    </div>
                    <p className="recommended-card-value">
                      {trackBBestBlobOutcome ? trackBBestBlobOutcome.title : "No eligible Blob tier"}
                    </p>
                    {trackBBestBlobReadiness && (
                      <>
                        <p className="recommended-card-readiness">
                          Readiness: {trackBBestBlobReadiness.readinessState}
                        </p>
                        {trackBBestBlobReadiness.readinessReasons?.length > 0 && (
                          <>
                            <h5 className="recommended-card-subheading">Readiness reasons</h5>
                            <ul className="readiness-reasons-list">
                              {trackBBestBlobReadiness.readinessReasons.map((reason, index) => (
                                <li key={`trackb-blob-readiness-${index}`}>{reason}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                    <h5 className="recommended-card-subheading">Why was this access tier recommended?</h5>
                    <ol className="recommended-logic-list">
                      {trackBBlobRecommendationReasonsFull.map((reason, index) => (
                        <li key={`trackb-blob-reason-${index}`}>{reason}</li>
                      ))}
                    </ol>
                    <button type="button" className="wave-plan-btn">Add to wave plan</button>
                  </article>
                )}

                {!shouldRenderFilesFirst && effectiveFilesSelected && (
                  <article className="recommended-card">
                    <div className="recommended-title-row">
                      <h4 className="recommended-card-title">Best Eligible Azure Files SKU</h4>
                      {filesComparisonStatus && (
                        <span className={getComparisonBadgeClass(filesComparisonStatus)}>{filesComparisonStatus}</span>
                      )}
                    </div>
                    <p className="recommended-card-value">
                      {trackBBestFilesOutcome ? trackBBestFilesOutcome.title : "No eligible Azure Files SKU"}
                    </p>
                    {trackBBestFilesReadiness && (
                      <>
                        <p className="recommended-card-readiness">
                          Readiness: {s3FilesCrossAssessmentEnabled ? "Ready with Condition" : trackBBestFilesReadiness.readinessState}
                        </p>
                        {trackBBestFilesReadiness.readinessReasons?.length > 0 && (
                          <>
                            <h5 className="recommended-card-subheading">Readiness reasons</h5>
                            <ul className="readiness-reasons-list">
                              {trackBBestFilesReadiness.readinessReasons.map((reason, index) => (
                                <li key={`trackb-files-readiness-${index}`}>{reason}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                    <h5 className="recommended-card-subheading">Why was this SKU recommended?</h5>
                    <ol className="recommended-logic-list">
                      {trackBFilesRecommendationReasons.map((reason, index) => (
                        <li key={`trackb-files-reason-${index}`}>{reason}</li>
                      ))}
                    </ol>
                    <button type="button" className="wave-plan-btn">Add to wave plan</button>
                  </article>
                )}
              </div>
            </section>
          )}

          {maximizeReadinessAcrossTargets && alternativeTrackBOutcome && (
            <section className="recommended-section" aria-label="Track B additional target option">
              <h3 className="recommended-heading">ADDITIONAL TARGET OPTION (MAXIMISE READINESS)</h3>
              <div className="recommended-grid">
                <article className="recommended-card">
                  <div className="recommended-title-row">
                    <h4 className="recommended-card-title">Additional cross-service option</h4>
                    <span className={getReadinessBadgeClass("Ready with Condition")}>Ready with Condition</span>
                    <span className="result-badge" aria-label="Readiness maximised">
                      Readiness maximised
                    </span>
                  </div>
                  <p className="recommended-card-value">{alternativeTrackBOutcome.title}</p>
                  <p className="recommended-card-readiness">Readiness: Ready with Condition</p>
                  {alternativeTrackBConditions.length > 0 && (
                    <>
                      <h5 className="recommended-card-subheading">Readiness reasons</h5>
                      <ul className="readiness-reasons-list">
                        {alternativeTrackBConditions.map((reason, index) => (
                          <li key={`trackb-alt-condition-${index}`}>{reason}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <h5 className="recommended-card-subheading">
                    {blobOutcomeSet.has(alternativeTrackBOutcome.id)
                      ? "Why was this access tier recommended?"
                      : "Why was this SKU recommended?"}
                  </h5>
                  <ol className="recommended-logic-list">
                    {alternativeTrackBRecommendationReasons.map((reason, index) => (
                      <li key={`trackb-alt-reason-${index}`}>{reason}</li>
                    ))}
                  </ol>
                  <button type="button" className="wave-plan-btn">Add to wave plan</button>
                </article>
              </div>
            </section>
          )}

          {trackBEvaluatedOutcomes.length === 0 ? (
            <p className="no-results">
              Track B did not return evaluated SKUs/tier for the current selection.
            </p>
          ) : (
            <details className="assessed-options-disclosure">
              <summary className="assessed-options-summary">Options that were assessed</summary>

              <div className="assessed-options-content">
                {!trackBHasReadyOrConditionalOutcome && (
                  <p className="no-results">
                    All Track B evaluated SKUs/tier are currently marked as Not Ready for the selected inputs.
                  </p>
                )}

                <ul className="results-list">
                  {orderedTrackBEvaluatedOutcomes.map((outcome) => {
                    const outcomeTier = getOutcomeTierLabel(outcome);
                    const redundancyAdjustment = getOutcomeRedundancyAdjustment(answers, outcome.id);
                    const effectiveRedundancy = redundancyAdjustment?.applied ?? answers?.redundancy;
                    const outcomeRedundancy =
                      redundancyLabelMap[effectiveRedundancy] ?? String(effectiveRedundancy ?? "N/A");
                    const readiness = trackBReadinessByOutcomeId.get(outcome.id);
                    const readinessState = readiness?.readinessState ?? "Not Ready";
                    const readinessReasons = readiness?.readinessReasons ?? ["No readiness details available."];

                    return (
                      <li key={`trackb-${outcome.id}`} className="result-item">
                        <div className="result-title-row">
                          <h3 className="result-title">{outcome.title}</h3>
                          <span className={getReadinessBadgeClass(readinessState)}>{readinessState}</span>
                          {redundancyAdjustment && redundancyAdjustment.requested !== redundancyAdjustment.applied && (
                            <span className="result-badge" aria-label="Redundancy adjusted for compatibility">
                              Redundancy downgraded to {redundancyLabelMap[redundancyAdjustment.applied]}
                            </span>
                          )}
                          {outcome.id === blobTierRegionAdjustment?.applied && (
                            <span className="result-badge" aria-label="Tier adjusted for regional availability">
                              Tier upgraded from {blobTierLabelMap[blobTierRegionAdjustment.requested]}
                            </span>
                          )}
                          {filesFallbackOutcomeSet.has(outcome.id) && (
                            <span className="result-badge" aria-label="Azure Files SKU adjusted for regional availability">
                              SKU switched due to regional availability
                            </span>
                          )}
                        </div>
                        <p className="result-meta">
                          Tier: {outcomeTier} | Redundancy: {outcomeRedundancy} | Protocol: {getSupportedProtocolLabelForOutcome(outcome.id)}
                        </p>
                        <ul className="readiness-reasons-list">
                          {readinessReasons.map((reason, index) => (
                            <li key={`trackb-${outcome.id}-reason-${index}`}>{reason}</li>
                          ))}
                        </ul>
                        <p className="result-description">{outcome.description}</p>
                        <button type="button" className="wave-plan-btn">Add to wave plan</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          )}
          </section>
        )}
      </div>

      {/* Inputs summary */}
      <div className="summary-section">
        <h3 className="summary-heading">Your selections</h3>
        <dl className="summary-list">
          {answeredQuestions.map((q) => (
            <div key={q.id} className="summary-row">
              <dt className="summary-label">{q.text}</dt>
              <dd className="summary-value">{resolveLabel(q, answers[q.id])}</dd>
            </div>
          ))}
        </dl>
      </div>

      <button className="restart-btn" onClick={onRestart}>
        ↩ Start Over
      </button>
    </div>
  );
}
