import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const sourcePath = path.join(
  rootDir,
  "src",
  "data",
  "preferred_choice_workload_protocol_sku_mapping.json"
);
const targetPath = path.join(
  rootDir,
  "src",
  "data",
  "preferred_choice_structured_mapping.json"
);

const protocolMap = {
  "SMB 2.x, 3.x": ["smb_v2", "smb_v3"],
  SMB: ["smb_v2", "smb_v3"],
  "NFS 3, 4.1": ["nfs_v3", "nfs_v41"],
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

function normalizeProtocolLabel(label) {
  return String(label ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^SMB NFS and S3$/i, "SMB, NFS and S3");
}

function generateStructuredRows(rawRows) {
  return rawRows.map((row, index) => {
    const sourceProtocolLabelRaw = normalizeProtocolLabel(row["Source protocol"]);
    const sourceProtocolValues = [...new Set(protocolMap[sourceProtocolLabelRaw] ?? [])];
    const sourceProtocolKey = [...sourceProtocolValues].sort().join("+");
    const sourceProtocolLabel = protocolKeyToLabel[sourceProtocolKey] ?? sourceProtocolLabelRaw;

    const supportsBlob = sourceProtocolValues.includes("s3") || sourceProtocolValues.includes("nfs_v3");
    const supportsFiles =
      sourceProtocolValues.includes("smb_v2")
      || sourceProtocolValues.includes("smb_v3")
      || sourceProtocolValues.includes("nfs_v41");

    const filesMediaTendency = String(row["Default Azure Files media tendency"] ?? "");
    const blobTierTendency = String(row["Azure Blob access tier tendency"] ?? "");

    const preferredFilesOutcomeId = supportsFiles
      ? (/ssd/i.test(filesMediaTendency) ? "files-premium-ssd" : "files-standard-hdd")
      : null;

    const preferredBlobOutcomeId = supportsBlob
      ? (/archive/i.test(blobTierTendency) ? "blob-archive" : "blob-hot")
      : null;

    return {
      id: `pcm-${String(index + 1).padStart(3, "0")}`,
      workloadType: row["Workload type"],
      sourceProtocolLabel,
      sourceProtocolValues,
      sourceProtocolKey,
      preferredFilesOutcomeId,
      preferredBlobOutcomeId,
      preferredChoiceRule: "trackB_preferred_choice_v2",
      source: {
        filesMediaTendency: row["Default Azure Files media tendency"],
        blobTierTendency: row["Azure Blob access tier tendency"],
        originalRecommendationText: row["Prioritised Target SKU/Recommended"],
      },
    };
  });
}

function main() {
  const rawRows = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const structuredRows = generateStructuredRows(rawRows);
  fs.writeFileSync(targetPath, `${JSON.stringify(structuredRows, null, 2)}\n`);
  console.log(`Generated ${structuredRows.length} rows at ${path.relative(rootDir, targetPath)}`);
}

main();
