# Wikidata Dictionary Build Pipeline

## Objective

This document turns the split Wikidata specs into a concrete file layout and command contract.

Pipeline stages:

1. extract a provenance-rich JSON-LD artifact from a pinned Wikidata snapshot
2. compile that artifact into a deterministic runtime dictionary
3. inject only the compiled `entriesMap` into `NormalizationTask.inputs`

## File Layout

```text
/Wikidata-Build-Time-Extraction-Artifact-Spec.md
/Runtime-Abbreviation-Dictionary-Spec.md
/Wikidata-Dictionary-Build-Pipeline.md
/README.md
/scripts/
  extract-wikidata.js
  compile-runtime-dictionary.js
/build/
  wikidata-domain.config.example.json
/artifacts/
  /examples/
    finance-extract.sample.jsonld
    finance-runtime.sample.json
```

## Command Contract

### 1. Build-Time Extraction

```bash
node ./scripts/extract-wikidata.js --config ./build/wikidata-domain.config.example.json --out ./artifacts/finance-extract.jsonld
```

Inputs:

- `--config`: JSON config describing the domain root, pinned snapshot label, and artifact metadata
- `--out`: output path for the extraction artifact

Output:

- JSON-LD extraction artifact conforming to `Wikidata-Build-Time-Extraction-Artifact-Spec.md`

### 2. Runtime Compilation

```bash
node ./scripts/compile-runtime-dictionary.js --in ./artifacts/finance-extract.jsonld --out ./artifacts/finance-runtime.json
```

Inputs:

- `--in`: extraction artifact path
- `--out`: runtime distribution artifact path

Output:

- runtime distribution JSON containing `entriesMap` and ambiguity diagnostics

## Config Contract

Example config shape:

```json
{
  "artifactId": "urn:uuid:wikidata-finance-extract-v1",
  "domainRoot": "wd:Q600473",
  "domainQid": "wd:Q600473",
  "sourceSnapshot": "wikidata-2026-04-01",
  "queryTemplateVersion": "wikidata-abbrev-v1",
  "languagePolicy": "shortName=en-or-none;label=en",
  "normalizationVersion": "build-normalization-v1",
  "endpoint": "https://query.wikidata.org/sparql"
}
```

Notes:

- `domainRoot` is recorded into the artifact
- `domainQid` is injected into the SPARQL query
- `sourceSnapshot` is metadata and must correspond to the pinned source used in your real build environment
- `endpoint` is included for convenience, but release builds should still run against a pinned mirror or snapshot service

## Build Outputs

### Extraction Artifact

This artifact preserves all candidate rows after deterministic normalization and exact duplicate collapse.

It is intended for:

- provenance
- auditability
- recompilation
- ambiguity inspection

It is not injected directly into runtime normalization.

### Runtime Distribution Artifact

This artifact contains:

- top-level metadata
- `entriesMap`
- `droppedAmbiguousKeys`

Only `entriesMap` is injected into `NormalizationTask.inputs`.

## Injection Example

```json
{
  "@type": "NormalizationTask",
  "rawIdentifier": "roi_value",
  "pipeline": {
    "@type": "PipelineDefinition",
    "rules": [
      {
        "@type": "Rule",
        "phase": "Enrichment",
        "order": 40,
        "ruleKind": "DictionaryExpand",
        "inputKey": "abbreviationDictionary",
        "missingInputBehavior": "skipWithWarning"
      }
    ]
  },
  "inputs": {
    "abbreviationDictionary": {
      "atm": "automated teller machine",
      "roi": "return on investment"
    }
  }
}
```

## Operational Notes

- `extract-wikidata.js` performs network access when pointed at a live endpoint and therefore is a build-time tool, not a browser/runtime tool
- `compile-runtime-dictionary.js` is fully offline and safe to run locally against extracted artifacts
- the sample extraction artifact in `artifacts/examples/` exists specifically so the compiler can be exercised without network access

## Recommended Release Flow

1. produce extraction artifact from a pinned snapshot
2. review `droppedAmbiguousKeys` candidates during compilation
3. publish both artifacts for traceability
4. inject only `entriesMap` into the runtime pipeline
