"use strict";

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeString(value) {
  return String(value).normalize("NFC");
}

function validateExtractionArtifact(artifact) {
  if (!artifact || artifact["@type"] !== "DictionaryExtractionArtifact") {
    throw new Error("Input artifact must have @type 'DictionaryExtractionArtifact'.");
  }

  const requiredTopLevel = ["@id", "domainRoot", "sourceSnapshot", "entries"];
  for (const key of requiredTopLevel) {
    if (!(key in artifact)) {
      throw new Error("Input artifact is missing required field '" + key + "'.");
    }
  }

  if (!Array.isArray(artifact.entries)) {
    throw new Error("Input artifact field 'entries' must be an array.");
  }
}

function compareStrings(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function createDistributionArtifact(artifact, inputKey, compilerVersion, groupedValues) {
  const retainedEntries = [];
  const droppedAmbiguousKeys = [];
  const sortedKeys = Array.from(groupedValues.keys()).sort(compareStrings);
  const entriesMap = {};

  for (const key of sortedKeys) {
    const group = groupedValues.get(key);
    const distinctValues = Array.from(group.values.keys()).sort(compareStrings);

    if (distinctValues.length === 1) {
      entriesMap[key] = distinctValues[0];
      retainedEntries.push(key);
      continue;
    }

    const candidates = [];
    for (const value of distinctValues) {
      const sourceEntities = Array.from(group.values.get(value)).sort(compareStrings);
      for (const sourceEntity of sourceEntities) {
        candidates.push({
          fullLabelValue: value,
          sourceEntity: sourceEntity
        });
      }
    }

    droppedAmbiguousKeys.push({
      shortNameKey: key,
      candidates: candidates
    });
  }

  return {
    dictionaryId: normalizeString(artifact["@id"]).replace("-extract-", "-runtime-"),
    sourceArtifact: normalizeString(artifact["@id"]),
    domainRoot: normalizeString(artifact.domainRoot),
    sourceSnapshot: normalizeString(artifact.sourceSnapshot),
    collisionPolicy: "strictDiscard",
    compilerVersion: compilerVersion,
    inputKey: inputKey,
    entriesMap: entriesMap,
    droppedAmbiguousKeys: droppedAmbiguousKeys
  };
}

function compileArtifact(artifact, inputKey, compilerVersion) {
  const groupedValues = new Map();

  for (const entry of artifact.entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const shortNameKey = typeof entry.shortNameKey === "string" ? normalizeString(entry.shortNameKey) : "";
    const fullLabelValue = typeof entry.fullLabelValue === "string" ? normalizeString(entry.fullLabelValue) : "";
    const sourceEntity = typeof entry.sourceEntity === "string" ? normalizeString(entry.sourceEntity) : "";

    if (!shortNameKey || !fullLabelValue || !sourceEntity) {
      continue;
    }

    if (!groupedValues.has(shortNameKey)) {
      groupedValues.set(shortNameKey, {
        values: new Map()
      });
    }

    const group = groupedValues.get(shortNameKey);
    if (!group.values.has(fullLabelValue)) {
      group.values.set(fullLabelValue, new Set());
    }
    group.values.get(fullLabelValue).add(sourceEntity);
  }

  return createDistributionArtifact(artifact, inputKey, compilerVersion, groupedValues);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inPath = args.in;
  const outPath = args.out;
  const inputKey = args.inputKey || "abbreviationDictionary";
  const compilerVersion = args.compilerVersion || "runtime-compiler-v1";

  if (!inPath || !outPath) {
    throw new Error("Usage: node ./scripts/compile-runtime-dictionary.js --in <extract.jsonld> --out <runtime.json> [--inputKey abbreviationDictionary]");
  }

  const artifact = readJson(path.resolve(inPath));
  validateExtractionArtifact(artifact);

  const distribution = compileArtifact(artifact, inputKey, compilerVersion);
  const resolvedOutPath = path.resolve(outPath);
  ensureDirForFile(resolvedOutPath);
  fs.writeFileSync(resolvedOutPath, JSON.stringify(distribution, null, 2) + "\n", "utf8");

  console.log("Wrote runtime dictionary to " + resolvedOutPath);
  console.log("Retained keys: " + Object.keys(distribution.entriesMap).length);
  console.log("Dropped ambiguous keys: " + distribution.droppedAmbiguousKeys.length);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
