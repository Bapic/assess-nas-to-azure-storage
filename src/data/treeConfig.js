/**
 * Decision Tree Configuration
 *
 * Structure:
 *   questions: array of question objects, each with:
 *     - id:          unique string identifier
 *     - text:        the question text shown to the user
 *     - type:        "buttons" (default) | "select" (dropdown) | "input"
 *     - defaultValue:(optional) default selected value for select-like inputs
 *     - placeholder: (select only) placeholder label shown as first disabled option
 *     - options:     flat array of { label, value }  — for button-style questions
 *                    OR grouped array of { group, items: [{ label, value }] } — for select dropdowns
 *
 *   outcomes: array of outcome objects, each with:
 *     - id:          unique string identifier
 *     - title:       short name of the product/outcome
 *     - description: longer explanation shown to the user
 *     - rules:       array of rule sets — an outcome is eligible if ANY rule set fully matches.
 *                    Each rule set is an object mapping questionId -> answer value.
 *                    e.g. [{ region: "eastus", accessPattern: "frequent" }]
 */

export const questions = [
  {
    id: "region",
    text: "Select an Azure region [Applicable for AzFiles and AzBlob]",
    type: "select",
    placeholder: "— Select a region —",
    options: [
      {
        group: "Americas",
        items: [
          { label: "East US", value: "eastus" },
          { label: "East US 2", value: "eastus2" },
          { label: "West US", value: "westus" },
          { label: "West US 2", value: "westus2" },
          { label: "West US 3", value: "westus3" },
          { label: "Central US", value: "centralus" },
          { label: "North Central US", value: "northcentralus" },
          { label: "South Central US", value: "southcentralus" },
          { label: "West Central US", value: "westcentralus" },
          { label: "Canada Central", value: "canadacentral" },
          { label: "Canada East", value: "canadaeast" },
          { label: "Brazil South", value: "brazilsouth" },
          { label: "Brazil Southeast", value: "brazilsoutheast" },
          { label: "Mexico Central", value: "mexicocentral" },
        ],
      },
      {
        group: "Europe",
        items: [
          { label: "North Europe", value: "northeurope" },
          { label: "West Europe", value: "westeurope" },
          { label: "UK South", value: "uksouth" },
          { label: "UK West", value: "ukwest" },
          { label: "France Central", value: "francecentral" },
          { label: "France South", value: "francesouth" },
          { label: "Germany West Central", value: "germanywestcentral" },
          { label: "Germany North", value: "germanynorth" },
          { label: "Switzerland North", value: "switzerlandnorth" },
          { label: "Switzerland West", value: "switzerlandwest" },
          { label: "Norway East", value: "norwayeast" },
          { label: "Norway West", value: "norwaywest" },
          { label: "Sweden Central", value: "swedencentral" },
          { label: "Poland Central", value: "polandcentral" },
          { label: "Italy North", value: "italynorth" },
          { label: "Austria East", value: "austriaeast" },
          { label: "Spain Central", value: "spaincentral" },
        ],
      },
      {
        group: "Asia Pacific",
        items: [
          { label: "East Asia", value: "eastasia" },
          { label: "Southeast Asia", value: "southeastasia" },
          { label: "Australia East", value: "australiaeast" },
          { label: "Australia Southeast", value: "australiasoutheast" },
          { label: "Australia Central", value: "australiacentral" },
          { label: "Australia Central 2", value: "australiacentral2" },
          { label: "Japan East", value: "japaneast" },
          { label: "Japan West", value: "japanwest" },
          { label: "Korea Central", value: "koreacentral" },
          { label: "Korea South", value: "koreasouth" },
          { label: "Central India", value: "centralindia" },
          { label: "South India", value: "southindia" },
          { label: "West India", value: "westindia" },
          { label: "New Zealand North", value: "newzealandnorth" },
        ],
      },
      {
        group: "Middle East & Africa",
        items: [
          { label: "UAE North", value: "uaenorth" },
          { label: "UAE Central", value: "uaecentral" },
          { label: "Qatar Central", value: "qatarcentral" },
          { label: "Israel Central", value: "israelcentral" },
          { label: "South Africa North", value: "southafricanorth" },
          { label: "South Africa West", value: "southafricawest" },
        ],
      },
    ],
  },
  {
    id: "nas",
    text: "Select your source NAS appliance",
    type: "select",
    placeholder: "\u2014 Select a NAS appliance \u2014",
    options: [
      { label: "NetApp ONTAP AFF / NetApp FAS", value: "netapp" },
      { label: "Dell Technologies PowerScale (OneFS) / Dell EMC Isilon (OneFS)", value: "dell" },
    ],
  },
  {
    id: "targetService",
    text: "Select a target Azure storage service",
    type: "multiselect",
    options: [
      { label: "Azure Blobs", value: "blobs" },
      { label: "Azure Files", value: "files" },
      // Only shown when source NAS is NetApp
      { label: "Azure NetApp Files", value: "anf", requiresAnswer: { nas: "netapp" } },
    ],
  },
  {
    id: "redundancy",
    text: "Select the redundancy type [Applicable for AzFiles and AzBlob]",
    type: "select",
    placeholder: "\u2014 Select a redundancy type \u2014",
    options: [
      { label: "LRS \u2014 Locally Redundant Storage", value: "lrs" },
      { label: "ZRS \u2014 Zone-Redundant Storage", value: "zrs" },
      { label: "GRS \u2014 Geo-Redundant Storage", value: "grs" },
      { label: "GZRS \u2014 Geo-Zone-Redundant Storage", value: "gzrs" },
    ],
  },
  {
    id: "sourceProtocol",
    text: "Enter your Fileshare source protocol",
    type: "multiselect",
    defaultValues: ["smb_v3"],
    options: [
      { label: "SMB v2.x", value: "smb_v2" },
      { label: "SMB v3.x", value: "smb_v3" },
      { label: "NFS v3", value: "nfs_v3" },
      { label: "NFS v4.1", value: "nfs_v41" },
      { label: "S3", value: "s3" },
    ],
  },
  {
    id: "sourceShareSizeTb",
    text: "File share size in GB",
    type: "input",
    placeholder: "Enter file share size (GB)",
  },
  {
    id: "sourceIops",
    text: "IOPS",
    type: "input",
    placeholder: "Enter required IOPS",
  },
  {
    id: "sourceThroughputMibps",
    text: "Throughput (MiB/s)",
    type: "input",
    placeholder: "Enter required throughput (MiB/s)",
  },
  {
    id: "comfortFactor",
    text: "Comfort factor",
    type: "select",
    defaultValue: "1.0",
    options: [
      { label: "1.0", value: "1.0" },
      { label: "1.2", value: "1.2" },
      { label: "1.5", value: "1.5" },
      { label: "2.0", value: "2.0" },
    ],
  },
  {
    id: "assessmentCriteria",
    text: "Assessment criteria",
    type: "select",
    placeholder: "— Select assessment criteria —",
    options: [
      { label: "Perf-based", value: "perf_based" },
      { label: "As on-premises", value: "as_on_premises" },
    ],
  },
  {
    id: "workloadType",
    text: "Select the workload type for your NAS shares",
    type: "select",
    placeholder: "— Select workload type —",
    tooltip: "Used only for calculating IO transactions for Azure Blob.",
    options: [
      {
        label: "Enterprise, mission-critical and AI/ML (training, feature stores, checkpoints)",
        value: "Enterprise, mission-critical and AI/ML (training, feature stores, checkpoints)",
      },
      {
        label: "Databases and stateful app components incl. logs, app state, exports, CI/CD",
        value: "Databases and stateful app components incl. logs, app state, exports, CI/CD",
      },
      {
        label: "General-purpose file shares / team shares (incl. user data shares)",
        value: "General-purpose file shares / team shares (incl. user data shares)",
      },
      {
        label: "Hybrid file services with Azure File Sync (on-prem cache handles performance; cloud tier for durability/scale)",
        value: "Hybrid file services with Azure File Sync (on-prem cache handles performance; cloud tier for durability/scale)",
      },
      {
        label: "Infrequently accessed data / backup, archives retained online (compliance, historical data)",
        value: "Infrequently accessed data / backup, archives retained online (compliance, historical data)",
      },
      {
        label: "Mixed workloads",
        value: "Mixed workloads",
      },
    ],
  },
  {
    id: "blobAccessFrequency",
    text: "Select the access frequency [Applicable for AzBlob]",
    type: "select",
    // Only shown when Azure Blobs is among the selected target services
    showIf: { targetService: { includes: "blobs" } },
    options: [
      { label: "Frequently \u2014 data accessed regularly", value: "hot" },
      { label: "Sometimes \u2014 accessed occasionally", value: "cool" },
      { label: "Rarely \u2014 seldom accessed but must remain online", value: "cold" },
      { label: "Hardly/Never \u2014 long-term retention, rarely if ever retrieved", value: "archive" },
    ],
  },
  {
    id: "blobWorkloadType",
    text: "Select the workload type for your object storage data",
    type: "select",
    note: "This selection is used only to calculate IOPS and transactions costs for all eligible storage SKUs.",
    // Only shown when Azure Blobs is among the selected target services.
    // Collected for cost calculation purposes; does not filter outcomes.
    showIf: { targetService: { includes: "blobs" } },
    options: [
      { label: "AI/ML workloads", value: "aiml" },
      { label: "CI/CD (build artefacts, source trees)", value: "cicd" },
      { label: "Backups", value: "backups" },
      { label: "Application data (logs, exports)", value: "appdata" },
      { label: "User data shares", value: "userdata" },
      { label: "Mixed workload types", value: "mixed" },
    ],
  },
  {
    id: "filesMediaType",
    text: "Select the media type [Applicable for AzFiles]",
    type: "multiselect",
    defaultValues: ["ssd", "hdd"],
    // Only shown when Azure Files is among the selected target services
    showIf: { targetService: { includes: "files" } },
    options: [
      { label: "Premium SSD", value: "ssd" },
      { label: "Standard HDD", value: "hdd" },
    ],
  },
];

/**
 * Maps each target service value to the outcome IDs it covers.
 * Used in matchOutcomes to filter results to only the selected services.
 */
export const serviceOutcomeMap = {
  blobs: ["blob-hot", "blob-cool", "blob-cold", "blob-archive"],
  files: ["files-standard-hdd", "files-premium-ssd"],
  anf:   ["anf-default"],
};

export const outcomes = [
  {
    id: "blob-hot",
    title: "Azure Blob Storage — Hot Tier",
    description:
      "Optimised for data that is accessed frequently. Offers the lowest access latency and highest storage cost among the Blob tiers. Ideal for active workloads such as serving web content, streaming, or real-time analytics.",
    rules: [], // populated once questions are defined
  },
  {
    id: "blob-cold",
    title: "Azure Blob Storage — Cold Tier",
    description:
      "Designed for data that is infrequently accessed and stored for at least 90 days. Lower storage costs than Cool with slightly higher access costs. Suits backup data or assets that are rarely retrieved.",
    rules: [],
  },
  {
    id: "blob-cool",
    title: "Azure Blob Storage — Cool Tier",
    description:
      "A cost-effective option for data that is infrequently accessed and stored for at least 30 days. Balances storage cost savings against moderate access costs. Good for short-term backups and disaster recovery data.",
    rules: [],
  },
  {
    id: "blob-archive",
    title: "Azure Blob Storage — Archive Tier",
    description:
      "The lowest-cost storage for data that is rarely accessed and can tolerate several hours of retrieval latency. Data must be stored for at least 180 days. Best suited for long-term retention, compliance archives, and raw data preservation.",
    rules: [],
  },
  {
    id: "files-standard-hdd",
    title: "Azure Files — Standard HDD (Provisioned v2)",
    description:
      "Fully managed file shares backed by HDD storage. Provisioned v2 allows independent provisioning of capacity, IOPS, and throughput. Well suited for general-purpose file shares, lift-and-shift workloads, and applications that don't require sub-millisecond latency.",
    rules: [],
  },
  {
    id: "files-premium-ssd",
    title: "Azure Files — Premium SSD (Provisioned v2)",
    description:
      "High-performance file shares backed by SSD storage. Delivers consistent low latency and high IOPS. Ideal for latency-sensitive workloads such as databases, DevOps tooling, HPC, and enterprise applications.",
    rules: [],
  },
  {
    id: "anf-default",
    title: "Azure NetApp Files — Default SKU",
    description:
      "Enterprise-grade, high-performance NFS/SMB file storage powered by NetApp technology. Offers multiple service levels (Standard, Premium, Ultra) and is suited for mission-critical workloads, SAP HANA, HPC, and workloads requiring advanced data management features such as snapshots and replication.",
    // ANF is only eligible when migrating from NetApp appliances
    rules: [{ nas: "netapp" }],
  },
];
