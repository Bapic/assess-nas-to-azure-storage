/**
 * Regional availability for each outcome SKU.
 *
 * Source (as of March 2026):
 *  - Azure Blob Storage access tiers (Hot/Cool/Cold/Archive) are treated as
 *    available across Azure public regions used by this app.
 *    https://learn.microsoft.com/azure/storage/blobs/access-tiers-overview
 *  - Azure Files Standard HDD Provisioned v2: generally available in all Azure
 *    public cloud regions used by this app.
 *    https://learn.microsoft.com/azure/storage/files/understanding-billing#provisioned-v2-availability
 *  - Azure Files Premium SSD (classic Microsoft.Storage file shares):
 *    supported in a subset of Azure regions for LRS/ZRS. The app's current
 *    selectable public regions are fully covered for SSD-LRS as of 2026-03-22,
 *    so SKU-level SSD region exclusions are currently empty for this region list.
 *    https://learn.microsoft.com/azure/storage/files/redundancy-premium-file-shares
 *  - Archive tier constraints are redundancy-based (not region-list-based):
 *    archive is supported with LRS/GRS/RA-GRS and not with ZRS/GZRS/RA-GZRS.
 *    https://learn.microsoft.com/azure/storage/common/storage-redundancy
 *    Redundancy-specific filtering is enforced in redundancyAvailability.js.
 *  - Azure products-by-region table currently excludes Archive Storage for
 *    specific public regions used by this app.
 *    https://azure.microsoft.com/en-gb/explore/global-infrastructure/products-by-region/table
 *  - Azure NetApp Files: Limited regional availability
 *    https://learn.microsoft.com/azure/azure-netapp-files/large-volumes-requirements-considerations#supported-regions
 *    (large volumes supported regions == ANF-enabled regions)
 *
 * Structure:
 *   Key   = outcome id (matches outcomes in treeConfig.js)
 *   Value = Set<string>    → available only in the listed region values
 */

// All Azure public regions currently exposed by the app's region question.
const PUBLIC_REGIONS = new Set([
  // Americas
  "eastus",
  "eastus2",
  "westus",
  "westus2",
  "westus3",
  "centralus",
  "northcentralus",
  "southcentralus",
  "westcentralus",
  "canadacentral",
  "canadaeast",
  "brazilsouth",
  "brazilsoutheast",
  "mexicocentral",

  // Europe
  "northeurope",
  "westeurope",
  "uksouth",
  "ukwest",
  "francecentral",
  "francesouth",
  "germanywestcentral",
  "germanynorth",
  "switzerlandnorth",
  "switzerlandwest",
  "norwayeast",
  "norwaywest",
  "swedencentral",
  "polandcentral",
  "italynorth",
  "austriaeast",
  "spaincentral",

  // Asia Pacific
  "eastasia",
  "southeastasia",
  "australiaeast",
  "australiasoutheast",
  "australiacentral",
  "australiacentral2",
  "japaneast",
  "japanwest",
  "koreacentral",
  "koreasouth",
  "centralindia",
  "southindia",
  "westindia",
  "newzealandnorth",

  // Middle East & Africa
  "uaenorth",
  "uaecentral",
  "qatarcentral",
  "israelcentral",
  "southafricanorth",
  "southafricawest",
]);

// Regions currently not listed for Blob Archive Storage in the products-by-region table.
const ARCHIVE_UNSUPPORTED_REGIONS = new Set([
  "brazilsoutheast",
  "mexicocentral",
  "germanynorth",
  "norwaywest",
  "polandcentral",
  "austriaeast",
  "spaincentral",
  "westindia",
  "newzealandnorth",
  "uaecentral",
  "qatarcentral",
  "israelcentral",
]);

const ARCHIVE_REGIONS = new Set(
  [...PUBLIC_REGIONS].filter((region) => !ARCHIVE_UNSUPPORTED_REGIONS.has(region))
);

// Azure Files Premium SSD LRS support verified from Microsoft Learn on 2026-03-22.
// For the app's current PUBLIC_REGIONS catalog, this set is currently equivalent
// to PUBLIC_REGIONS; exclusions are tracked explicitly for future updates.
const FILES_PREMIUM_SSD_LRS_REGIONS = new Set(PUBLIC_REGIONS);
const FILES_PREMIUM_SSD_UNSUPPORTED_REGIONS = new Set(
  [...PUBLIC_REGIONS].filter((region) => !FILES_PREMIUM_SSD_LRS_REGIONS.has(region))
);

// Keep this alias in case future SKU-level exclusions need to be populated.
const FILES_PREMIUM_SSD_REGIONS = new Set(
  [...PUBLIC_REGIONS].filter((region) => !FILES_PREMIUM_SSD_UNSUPPORTED_REGIONS.has(region))
);

// Regions where Azure NetApp Files is GA (using the region values from treeConfig.js)
const ANF_REGIONS = new Set([
  // Americas
  "eastus",
  "eastus2",
  "westus",
  "westus2",
  "westus3",
  "centralus",
  "northcentralus",
  "southcentralus",
  "canadacentral",
  "canadaeast",
  "brazilsouth",
  "brazilsoutheast",
  // NOTE: mexicocentral and westcentralus are NOT supported by ANF

  // Europe
  "northeurope",
  "westeurope",
  "uksouth",
  "ukwest",
  "francecentral",
  // NOTE: francesouth is NOT supported by ANF
  "germanywestcentral",
  "germanynorth",
  "switzerlandnorth",
  "switzerlandwest",
  "norwayeast",
  "norwaywest",
  "swedencentral",
  // NOTE: polandcentral is NOT supported by ANF
  "italynorth",
  "spaincentral",

  // Asia Pacific
  "eastasia",
  "southeastasia",
  "australiaeast",
  "australiasoutheast",
  "australiacentral",
  "australiacentral2",
  "japaneast",
  "japanwest",
  "koreacentral",
  "koreasouth",
  "centralindia",
  // NOTE: southindia, westindia, newzealandnorth are NOT supported by ANF

  // Middle East & Africa
  "uaenorth",
  // NOTE: uaecentral is NOT supported by ANF
  "qatarcentral",
  // NOTE: israelcentral is NOT supported by ANF
  "southafricanorth",
  // NOTE: southafricawest is NOT supported by ANF
]);

export const outcomeRegionAvailability = {
  "blob-hot":           PUBLIC_REGIONS,
  "blob-cold":          PUBLIC_REGIONS,
  "blob-cool":          PUBLIC_REGIONS,
  "blob-archive":       ARCHIVE_REGIONS,
  "files-standard-hdd": PUBLIC_REGIONS,
  "files-premium-ssd":  FILES_PREMIUM_SSD_REGIONS,
  "anf-default":        ANF_REGIONS,
};

/**
 * Returns true if the given outcome is available in the selected region.
 * @param {string} outcomeId
 * @param {string} regionValue  – the value from the region dropdown
 */
export function isAvailableInRegion(outcomeId, regionValue) {
  const availability = outcomeRegionAvailability[outcomeId];
  if (!availability) return true;
  return availability.has(regionValue);
}
