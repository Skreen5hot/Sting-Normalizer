"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EXTRACTION_CONTEXT = {
  "@context": {
    "ex": "http://example.org/vocab#",
    "wd": "http://www.wikidata.org/entity/",
    "DictionaryExtractionArtifact": "ex:DictionaryExtractionArtifact",
    "AbbreviationCandidate": "ex:AbbreviationCandidate",
    "domainRoot": "ex:domainRoot",
    "sourceSnapshot": "ex:sourceSnapshot",
    "queryTemplateVersion": "ex:queryTemplateVersion",
    "languagePolicy": "ex:languagePolicy",
    "normalizationVersion": "ex:normalizationVersion",
    "entries": "ex:entries",
    "shortNameRaw": "ex:shortNameRaw",
    "fullLabelRaw": "ex:fullLabelRaw",
    "shortNameKey": "ex:shortNameKey",
    "fullLabelValue": "ex:fullLabelValue",
    "sourceEntity": "ex:sourceEntity"
  }
};

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

function computeShortNameKey(value) {
  return normalizeString(value)
    .replace(/[\p{Z}\p{P}]+/gu, "")
    .toLowerCase();
}

function computeFullLabelValue(value) {
  const tokens = normalizeString(value)
    .split(/[\p{Z}\p{P}]+/u)
    .filter(Boolean)
    .map((token) => token.toLowerCase());

  return tokens.join(" ");
}

function sortEntries(entries) {
  return entries.sort((left, right) => {
    if (left.shortNameKey !== right.shortNameKey) {
      return left.shortNameKey < right.shortNameKey ? -1 : 1;
    }
    if (left.fullLabelValue !== right.fullLabelValue) {
      return left.fullLabelValue < right.fullLabelValue ? -1 : 1;
    }
    if (left.sourceEntity !== right.sourceEntity) {
      return left.sourceEntity < right.sourceEntity ? -1 : 1;
    }
    return 0;
  });
}

function validateConfig(config) {
  const requiredKeys = [
    "artifactId",
    "domainRoot",
    "domainQid",
    "sourceSnapshot",
    "queryTemplateVersion",
    "languagePolicy",
    "normalizationVersion",
    "endpoint"
  ];

  for (const key of requiredKeys) {
    if (typeof config[key] !== "string" || config[key].trim() === "") {
      throw new Error("Config field '" + key + "' must be a non-empty string.");
    }
  }
}

function buildQuery(domainQid) {
  return [
    "SELECT DISTINCT ?shortName ?fullLabel ?concept WHERE {",
    "  {",
    "    ?concept wdt:P279* " + domainQid + " .",
    "  }",
    "  UNION",
    "  {",
    "    ?concept wdt:P31/wdt:P279* " + domainQid + " .",
    "  }",
    "",
    "  ?concept wdt:P1813 ?shortName .",
    "  FILTER(LANG(?shortName) = \"en\" || LANG(?shortName) = \"\")",
    "",
    "  ?concept rdfs:label ?fullLabel .",
    "  FILTER(LANG(?fullLabel) = \"en\")",
    "}"
  ].join("\n");
}

async function fetchSparqlResults(endpoint, query) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "accept": "application/sparql-results+json",
      "content-type": "application/sparql-query; charset=utf-8",
      "user-agent": "Key-Normalizer-BuildPipeline/0.1"
    },
    body: query
  });

  if (!response.ok) {
    throw new Error("SPARQL request failed with status " + response.status + ".");
  }

  return response.json();
}

function bindingValue(binding, key) {
  return binding && binding[key] && typeof binding[key].value === "string"
    ? binding[key].value
    : "";
}

function transformBindingsToEntries(bindings) {
  const dedupe = new Map();

  for (const binding of bindings) {
    const shortNameRaw = bindingValue(binding, "shortName");
    const fullLabelRaw = bindingValue(binding, "fullLabel");
    const sourceEntity = bindingValue(binding, "concept");

    if (!shortNameRaw || !fullLabelRaw || !sourceEntity) {
      continue;
    }

    const normalizedShortNameRaw = normalizeString(shortNameRaw);
    const normalizedFullLabelRaw = normalizeString(fullLabelRaw);
    const shortNameKey = computeShortNameKey(normalizedShortNameRaw);
    const fullLabelValue = computeFullLabelValue(normalizedFullLabelRaw);

    if (!shortNameKey || !fullLabelValue) {
      continue;
    }

    const entry = {
      "@type": "AbbreviationCandidate",
      shortNameRaw: normalizedShortNameRaw,
      fullLabelRaw: normalizedFullLabelRaw,
      shortNameKey: shortNameKey,
      fullLabelValue: fullLabelValue,
      sourceEntity: normalizeString(sourceEntity)
    };

    const dedupeKey = [
      entry.shortNameKey,
      entry.fullLabelValue,
      entry.sourceEntity
    ].join("\u0000");

    if (!dedupe.has(dedupeKey)) {
      dedupe.set(dedupeKey, entry);
    }
  }

  return sortEntries(Array.from(dedupe.values()));
}

function buildArtifact(config, entries) {
  return {
    "@context": EXTRACTION_CONTEXT["@context"],
    "@type": "DictionaryExtractionArtifact",
    "@id": normalizeString(config.artifactId),
    "domainRoot": normalizeString(config.domainRoot),
    "sourceSnapshot": normalizeString(config.sourceSnapshot),
    "queryTemplateVersion": normalizeString(config.queryTemplateVersion),
    "languagePolicy": normalizeString(config.languagePolicy),
    "normalizationVersion": normalizeString(config.normalizationVersion),
    "entries": entries
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config;
  const outPath = args.out;

  if (!configPath || !outPath) {
    throw new Error("Usage: node ./scripts/extract-wikidata.js --config <config.json> --out <artifact.jsonld>");
  }

  const config = readJson(path.resolve(configPath));
  validateConfig(config);

  const query = buildQuery(config.domainQid);
  const result = await fetchSparqlResults(config.endpoint, query);
  const bindings = result && result.results && Array.isArray(result.results.bindings)
    ? result.results.bindings
    : null;

  if (!bindings) {
    throw new Error("SPARQL result did not contain results.bindings.");
  }

  const artifact = buildArtifact(config, transformBindingsToEntries(bindings));
  const resolvedOutPath = path.resolve(outPath);
  ensureDirForFile(resolvedOutPath);
  fs.writeFileSync(resolvedOutPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  console.log("Wrote extraction artifact to " + resolvedOutPath);
  console.log("Entries: " + artifact.entries.length);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
