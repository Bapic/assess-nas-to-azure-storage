import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const structuredSourcePath = path.join(
  rootDir,
  "src",
  "data",
  "preferred_choice_structured_mapping.json"
);
const flatJsonTargetPath = path.join(
  rootDir,
  "src",
  "data",
  "preferred_choice_workload_protocol_sku_mapping.json"
);
const csvTargetPath = path.join(
  rootDir,
  "src",
  "data",
  "preferred_choice_workload_protocol_sku_mapping.csv"
);

const protocolMap = {
  "SMB 2.x, 3.x": ["smb_v2", "smb_v3"],
  "SMB 2.x": ["smb_v2"],
  "SMB 3.x": ["smb_v3"],
  "SMB 2.x, SMB 3.x": ["smb_v2", "smb_v3"],
  SMB: ["smb_v2", "smb_v3"],
  "NFS 3, 4.1": ["nfs_v3", "nfs_v41"],
  "NFS 3": ["nfs_v3"],
  "NFS 4.1": ["nfs_v41"],
  "NFS 3, NFS 4.1": ["nfs_v3", "nfs_v41"],
  NFS: ["nfs_v3", "nfs_v41"],
  S3: ["s3"],
  "SMB and NFS": ["smb_v2", "smb_v3", "nfs_v3", "nfs_v41"],
  "SMB and S3": ["smb_v2", "smb_v3", "s3"],
  "NFS and S3": ["nfs_v3", "nfs_v41", "s3"],
  "SMB, NFS and S3": ["smb_v2", "smb_v3", "nfs_v3", "nfs_v41", "s3"],
  "SMB NFS and S3": ["smb_v2", "smb_v3", "nfs_v3", "nfs_v41", "s3"],
};

const protocolKeyToLabel = {
  "smb_v2+smb_v3": "SMB 2.x, 3.x",
  "nfs_v3+nfs_v41": "NFS 3, 4.1",
  "smb_v2+smb_v3+nfs_v3+nfs_v41+s3": "SMB, NFS and S3",
};

const expectedWorkloadProfiles = {
  "AI/ML workloads (training, features etc.)": {
    "Expected avg file size (used for Blob IO transaction calculations baseline)": "50 MB to 5 GB (typical 100 MB)",
    "Files per directory (avg) (used for Blob IO transaction calculations baseline)": "10 to 200 (typical 100)",
    "Directory depth (used for Blob IO transaction calculations baseline)": "3 to 8 (typical 5)",
    "File churn (used for Blob IO transaction calculations baseline)": "Medium",
  },
  "Enterprise, mission-critical": {
    "Expected avg file size (used for Blob IO transaction calculations baseline)": "50 MB to 5 GB (typical 100 MB)",
    "Files per directory (avg) (used for Blob IO transaction calculations baseline)": "10 to 200 (typical 100)",
    "Directory depth (used for Blob IO transaction calculations baseline)": "3 to 8 (typical 5)",
    "File churn (used for Blob IO transaction calculations baseline)": "Medium",
  },
  "Databases and stateful app components": {
    "Expected avg file size (used for Blob IO transaction calculations baseline)": "10 KB to 100 MB (typical 1 to 2 MB)",
    "Files per directory (avg) (used for Blob IO transaction calculations baseline)": "100 to 5,000 (typical 200 to 500)",
    "Directory depth (used for Blob IO transaction calculations baseline)": "3 to 15 (typical 5 to 10)",
    "File churn (used for Blob IO transaction calculations baseline)": "High (can be very high for CI/CD)",
  },
  "General-purpose file shares": {
    "Expected avg file size (used for Blob IO transaction calculations baseline)": "50 KB to 10 MB (typical 1 MB)",
    "Files per directory (avg) (used for Blob IO transaction calculations baseline)": "100 to 5,000 (typical 200)",
    "Directory depth (used for Blob IO transaction calculations baseline)": "3 to 12 (typical 5)",
    "File churn (used for Blob IO transaction calculations baseline)": "Medium",
  },
  "Infrequently used (archive, backup)": {
    "Expected avg file size (used for Blob IO transaction calculations baseline)": "1 MB to 100 MB (typical 10 MB)",
    "Files per directory (avg) (used for Blob IO transaction calculations baseline)": "100 to 1,000 (typical 500)",
    "Directory depth (used for Blob IO transaction calculations baseline)": "2 to 6 (typical 4)",
    "File churn (used for Blob IO transaction calculations baseline)": "Low",
  },
  "Mixed workloads (various workloads combinations)": {
    "Expected avg file size (used for Blob IO transaction calculations baseline)": "50 MB to 5 GB (typical 100 MB)",
    "Files per directory (avg) (used for Blob IO transaction calculations baseline)": "10 to 200 (typical 100)",
    "Directory depth (used for Blob IO transaction calculations baseline)": "3 to 8 (typical 5)",
    "File churn (used for Blob IO transaction calculations baseline)": "Medium",
  },
};

const expectedProtocolLabels = [
  "SMB 2.x, 3.x",
  "SMB 2.x",
  "SMB 3.x",
  "NFS 3, 4.1",
  "NFS 3",
  "NFS 4.1",
  "S3",
  "SMB and NFS",
  "SMB and S3",
  "NFS and S3",
  "SMB, NFS and S3",
];

function normalizeProtocolLabel(rawLabel) {
  const normalized = String(rawLabel ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^SMB NFS and S3$/i, "SMB, NFS and S3");

  if (/^SMB 2\.x\s*,\s*SMB 3\.x$/i.test(normalized)) {
    return "SMB 2.x, 3.x";
  }

  if (/^NFS 3\s*,\s*NFS 4\.1$/i.test(normalized)) {
    return "NFS 3, 4.1";
  }

  return normalized;
}

function canonicalizeProtocolLabel(rawLabel) {
  const normalized = normalizeProtocolLabel(rawLabel);
  const values = [...new Set(protocolMap[normalized] ?? [])];
  if (values.length === 0) {
    throw new Error(`Unknown protocol label in structured mapping: "${rawLabel}"`);
  }
  const key = [...values].sort().join("+");
  return protocolKeyToLabel[key] ?? normalized;
}

function validateStructuredRows(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Structured mapping must be a JSON array.");
  }

  const expectedWorkloads = Object.keys(expectedWorkloadProfiles);
  const protocolSet = new Set(expectedProtocolLabels);
  const expectedRowCount = expectedWorkloads.length * expectedProtocolLabels.length;
  const seenPairs = new Set();
  const coverage = new Map(expectedWorkloads.map((wl) => [wl, new Set()]));

  for (const row of rows) {
    const workloadType = String(row?.workloadType ?? "").trim();
    const recommendation = String(row?.source?.originalRecommendationText ?? "").trim();
    const filesMediaTendency = String(row?.source?.filesMediaTendency ?? "").trim();
    const blobTierTendency = String(row?.source?.blobTierTendency ?? "").trim();
    const sourceProtocolLabel = canonicalizeProtocolLabel(row?.sourceProtocolLabel);

    if (!expectedWorkloadProfiles[workloadType]) {
      throw new Error(`Unexpected workload type in structured mapping: "${workloadType}"`);
    }
    if (!protocolSet.has(sourceProtocolLabel)) {
      throw new Error(`Unexpected source protocol in structured mapping: "${sourceProtocolLabel}"`);
    }
    if (!recommendation) {
      throw new Error(`Missing recommendation text for workload "${workloadType}" and protocol "${sourceProtocolLabel}".`);
    }
    if (!filesMediaTendency || !blobTierTendency) {
      throw new Error(`Missing tendency metadata for workload "${workloadType}" and protocol "${sourceProtocolLabel}".`);
    }

    const key = `${workloadType}__${sourceProtocolLabel}`;
    if (seenPairs.has(key)) {
      throw new Error(`Duplicate structured mapping row for workload/protocol pair: ${key}`);
    }
    seenPairs.add(key);
    coverage.get(workloadType)?.add(sourceProtocolLabel);
  }

  if (rows.length !== expectedRowCount) {
    throw new Error(`Structured mapping row count mismatch: expected ${expectedRowCount}, found ${rows.length}.`);
  }

  for (const workloadType of expectedWorkloads) {
    const labels = coverage.get(workloadType) ?? new Set();
    for (const protocolLabel of expectedProtocolLabels) {
      if (!labels.has(protocolLabel)) {
        throw new Error(`Missing workload/protocol mapping: ${workloadType} / ${protocolLabel}`);
      }
    }
  }
}

function toFlatRows(rows) {
  const expectedWorkloads = Object.keys(expectedWorkloadProfiles);
  const workloadOrder = new Map(expectedWorkloads.map((wl, idx) => [wl, idx]));
  const protocolOrder = new Map(expectedProtocolLabels.map((label, idx) => [label, idx]));

  const canonicalRows = rows
    .map((row) => ({
      ...row,
      sourceProtocolLabel: canonicalizeProtocolLabel(row.sourceProtocolLabel),
    }))
    .sort((a, b) => {
      const workloadSort = (workloadOrder.get(a.workloadType) ?? Number.MAX_SAFE_INTEGER)
        - (workloadOrder.get(b.workloadType) ?? Number.MAX_SAFE_INTEGER);
      if (workloadSort !== 0) return workloadSort;
      return (protocolOrder.get(a.sourceProtocolLabel) ?? Number.MAX_SAFE_INTEGER)
        - (protocolOrder.get(b.sourceProtocolLabel) ?? Number.MAX_SAFE_INTEGER);
    });

  return canonicalRows.map((row) => {
    const profile = expectedWorkloadProfiles[row.workloadType];
    return {
      "Workload type": row.workloadType,
      ...profile,
      "Default Azure Files media tendency": row.source.filesMediaTendency,
      "Azure Blob access tier tendency": row.source.blobTierTendency,
      "Source protocol": row.sourceProtocolLabel,
      "Prioritised Target SKU/Recommended": row.source.originalRecommendationText,
    };
  });
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = [
    "Workload type",
    "Expected avg file size (used for Blob IO transaction calculations baseline)",
    "Files per directory (avg) (used for Blob IO transaction calculations baseline)",
    "Directory depth (used for Blob IO transaction calculations baseline)",
    "File churn (used for Blob IO transaction calculations baseline)",
    "Default Azure Files media tendency",
    "Azure Blob access tier tendency",
    "Source protocol",
    "Prioritised Target SKU/Recommended",
  ];

  const lines = [headers.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const structuredRows = JSON.parse(fs.readFileSync(structuredSourcePath, "utf8"));
  validateStructuredRows(structuredRows);

  const flatRows = toFlatRows(structuredRows);
  const csv = toCsv(flatRows);

  fs.writeFileSync(flatJsonTargetPath, `${JSON.stringify(flatRows, null, 2)}\n`);
  fs.writeFileSync(csvTargetPath, csv);

  console.log(`Validated ${structuredRows.length} structured rows at ${path.relative(rootDir, structuredSourcePath)}`);
  console.log(`Generated ${flatRows.length} rows at ${path.relative(rootDir, flatJsonTargetPath)}`);
  console.log(`Generated ${flatRows.length} CSV rows at ${path.relative(rootDir, csvTargetPath)}`);
}

main();
