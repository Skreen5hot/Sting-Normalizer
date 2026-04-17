# Specification: Build-Time Dictionary Extraction Artifact (Wikidata)

## 1. Status

This specification defines the build-time extraction artifact for Wikidata-backed abbreviation harvesting.

It is intentionally separate from the runtime dictionary contract. The extraction artifact is provenance-rich, may preserve ambiguity, and is not injected directly into `NormalizationTask.inputs`.

This document is designed to align with the hardened runtime model in `Deterministic-Key-Normalization-Pipeline-v2.1.md`.

## 2. Objective

The objective of this build step is to harvest domain-specific abbreviation candidates from Wikidata and emit a deterministic JSON-LD extraction artifact that:

- records the exact source snapshot and query contract used to produce it
- preserves one candidate record per source concept
- normalizes relevant strings into canonical build-time fields
- does not perform collision resolution for runtime lookup
- can be compiled later into a runtime dictionary artifact

This step is classified as build-time infrastructure and MUST NOT execute in the browser during runtime normalization.

## 3. Determinism and Reproducibility Requirements

### 3.1 Pinned Source Snapshot

A conforming build MUST run against a pinned Wikidata snapshot.

Acceptable sources include:

- a local Wikidata dump with a recorded dump date
- an internal mirror whose contents are pinned to a recorded dump date
- a pre-materialized queryable snapshot with an immutable version identifier

The public live Wikidata Query Service MAY be used for exploration, but MUST NOT be used to produce release artifacts unless the resulting artifact is explicitly marked non-reproducible and rejected from release pipelines.

### 3.2 Stable Build Inputs

The build orchestrator MUST record:

- `domainRoot`
- `sourceSnapshot`
- `queryTemplateVersion`
- `languagePolicy`
- `normalizationVersion`

If any of these inputs change, the build artifact version MUST change.

### 3.3 Stable Output Ordering

The final `entries` array MUST be sorted deterministically by:

1. `shortNameKey`
2. `fullLabelValue`
3. `sourceEntity`

Sorting comparisons MUST be byte-stable on the normalized NFC string values.

## 4. Extraction Contract

### 4.1 Candidate Eligibility

A candidate concept MUST satisfy all of the following:

1. it belongs to the target domain subtree
2. it has at least one `P1813` short name in English or language-agnostic form
3. it has an English `rdfs:label`

### 4.2 Domain Membership Semantics

This specification defines domain membership as either of the following:

- the concept is a subclass of the target domain root
- the concept is an instance of a class that is within the target domain subtree

This is intentionally broader than a pure `P31` path and MUST be implemented exactly as specified in the SPARQL contract below.

### 4.3 SPARQL Template

`{{DOMAIN_QID}}` is injected at build time, for example `wd:Q855380`.

```sparql
SELECT DISTINCT ?shortName ?fullLabel ?concept WHERE {
  {
    ?concept wdt:P279* {{DOMAIN_QID}} .
  }
  UNION
  {
    ?concept wdt:P31/wdt:P279* {{DOMAIN_QID}} .
  }

  ?concept wdt:P1813 ?shortName .
  FILTER(LANG(?shortName) = "en" || LANG(?shortName) = "")

  ?concept rdfs:label ?fullLabel .
  FILTER(LANG(?fullLabel) = "en")
}
```

### 4.4 Raw Result Requirements

Each row from the SPARQL result set MUST be treated as an independent candidate prior to normalization and deduplication.

The raw fields retained from the query are:

- `concept`
- `shortName`
- `fullLabel`

## 5. Transformation Rules

The orchestrator MUST transform the raw query rows into deterministic candidate entries.

### 5.1 String Normalization

Before any derived field is computed, all string values MUST be normalized to Unicode NFC.

This includes:

- `shortName`
- `fullLabel`
- derived keys and values

### 5.2 Derived Candidate Fields

Each retained row MUST produce the following canonical fields:

- `shortNameRaw`
- `fullLabelRaw`
- `shortNameKey`
- `fullLabelValue`
- `sourceEntity`

#### 5.2.1 `shortNameKey`

`shortNameKey` is the runtime-facing abbreviation key derived from `shortNameRaw`.

It MUST be computed as follows:

1. normalize to NFC
2. remove all Unicode whitespace and punctuation characters matched by `/[\p{Z}\p{P}]+/u`
3. lowercase using locale-independent ECMAScript default lowercasing

Examples:

- `ATM` -> `atm`
- `R.O.I.` -> `roi`
- `Mac` -> `mac`

If the resulting key is empty, the row MUST be discarded.

#### 5.2.2 `fullLabelValue`

`fullLabelValue` is the runtime-facing expansion string derived from `fullLabelRaw`.

It MUST be computed as follows:

1. normalize to NFC
2. split on `/[\p{Z}\p{P}]+/u`
3. discard empty tokens
4. lowercase each token
5. join tokens with a single ASCII space

Examples:

- `Automated Teller Machine` -> `automated teller machine`
- `Return-on-investment` -> `return on investment`

If the resulting value is empty, the row MUST be discarded.

### 5.3 Exact Duplicate Collapse

If multiple rows produce the same tuple:

- `shortNameKey`
- `fullLabelValue`
- `sourceEntity`

they MUST collapse into a single entry.

### 5.4 Ambiguity Preservation

If multiple source concepts share the same `shortNameKey` but produce different `fullLabelValue` values, the extraction artifact MUST preserve all distinct candidate entries.

The extraction artifact MUST NOT resolve or discard these collisions. That responsibility belongs to the runtime dictionary compilation step.

## 6. Canonical JSON-LD Output

### 6.1 Context

```json
{
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
}
```

### 6.2 Artifact Contract

The extraction artifact MUST contain:

- `@type: "DictionaryExtractionArtifact"`
- `@id`
- `domainRoot`
- `sourceSnapshot`
- `queryTemplateVersion`
- `languagePolicy`
- `normalizationVersion`
- `entries`

Each `entries[]` item MUST contain:

- `@type: "AbbreviationCandidate"`
- `shortNameRaw`
- `fullLabelRaw`
- `shortNameKey`
- `fullLabelValue`
- `sourceEntity`

### 6.3 Example Output

```json
{
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
  },
  "@type": "DictionaryExtractionArtifact",
  "@id": "urn:uuid:wikidata-finance-extract-v1",
  "domainRoot": "wd:Q600473",
  "sourceSnapshot": "wikidata-2026-04-01",
  "queryTemplateVersion": "wikidata-abbrev-v1",
  "languagePolicy": "shortName=en-or-none;label=en",
  "normalizationVersion": "build-normalization-v1",
  "entries": [
    {
      "@type": "AbbreviationCandidate",
      "shortNameRaw": "ATM",
      "fullLabelRaw": "automated teller machine",
      "shortNameKey": "atm",
      "fullLabelValue": "automated teller machine",
      "sourceEntity": "http://www.wikidata.org/entity/Q81235"
    },
    {
      "@type": "AbbreviationCandidate",
      "shortNameRaw": "ROI",
      "fullLabelRaw": "return on investment",
      "shortNameKey": "roi",
      "fullLabelValue": "return on investment",
      "sourceEntity": "http://www.wikidata.org/entity/Q49250"
    },
    {
      "@type": "AbbreviationCandidate",
      "shortNameRaw": "MAC",
      "fullLabelRaw": "Media Access Control",
      "shortNameKey": "mac",
      "fullLabelValue": "media access control",
      "sourceEntity": "http://www.wikidata.org/entity/Q507734"
    },
    {
      "@type": "AbbreviationCandidate",
      "shortNameRaw": "Mac",
      "fullLabelRaw": "Macintosh",
      "shortNameKey": "mac",
      "fullLabelValue": "macintosh",
      "sourceEntity": "http://www.wikidata.org/entity/Q622302"
    }
  ]
}
```

## 7. Failure Modes

The extraction build MUST fail if:

- the source snapshot is not recorded
- the SPARQL query fails or returns a transport error
- the result set cannot be parsed
- the final artifact cannot be deterministically sorted

The extraction build MAY succeed with zero `entries`, but only if the artifact explicitly records the requested `domainRoot` and `sourceSnapshot`.

## 8. Non-Goals

This specification does not define:

- runtime lookup behavior
- collision resolution for ambiguous abbreviations
- `NormalizationTask.inputs` structure

Those concerns are defined in the runtime dictionary specification.
