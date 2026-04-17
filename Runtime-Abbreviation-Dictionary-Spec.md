# Specification: Runtime Abbreviation Dictionary (Compiled Input)

## 1. Status

This specification defines the runtime dictionary artifact compiled from a build-time extraction artifact.

It is intentionally separate from the Wikidata extraction artifact specification. The runtime artifact is optimized for deterministic lookup by the hardened v2.1 `DictionaryExpand` rule.

This document aligns with `Deterministic-Key-Normalization-Pipeline-v2.1.md`, especially:

- `NormalizationTask.inputs`
- `DictionaryExpand`
- `missingInputBehavior`

## 2. Objective

The objective of this compilation step is to convert a provenance-rich extraction artifact into a deterministic runtime dictionary that can be injected directly into:

```json
NormalizationTask.inputs[<inputKey>]
```

The runtime dictionary MUST be a plain JSON object whose entries are string-to-string mappings, because the v2.1 `DictionaryExpand` rule requires exactly that shape.

## 3. Input Contract

The compiler input MUST be a valid extraction artifact as defined in `Wikidata-Build-Time-Extraction-Artifact-Spec.md`.

The compiler MUST read:

- `@id`
- `domainRoot`
- `sourceSnapshot`
- `entries[]`

Each candidate entry MUST supply:

- `shortNameKey`
- `fullLabelValue`
- `sourceEntity`

## 4. Runtime Compilation Rules

### 4.1 Eligibility

Only entries with all of the following are eligible for compilation:

- non-empty `shortNameKey`
- non-empty `fullLabelValue`
- non-empty `sourceEntity`

Invalid entries MUST be discarded before collision grouping.

### 4.2 Grouping

Entries MUST be grouped by `shortNameKey`.

Within each group, duplicate `fullLabelValue` values MUST collapse into a single candidate value for collision analysis.

### 4.3 Collision Policy

This runtime specification defines a single normative collision policy:

- `strictDiscard`

Under `strictDiscard`:

- if a `shortNameKey` maps to exactly one distinct `fullLabelValue`, that mapping is retained
- if a `shortNameKey` maps to more than one distinct `fullLabelValue`, that key is discarded from the runtime dictionary

This policy is mandatory for conformance to the current v2.1 runtime contract because `DictionaryExpand` accepts only string-to-string entries.

### 4.4 Canonical Ordering

The final runtime map MUST be serialized in ascending lexicographic order by key.

If companion metadata is emitted, any ambiguity reports MUST sort by:

1. `shortNameKey`
2. candidate `fullLabelValue`
3. `sourceEntity`

### 4.5 No Ambiguity at Runtime

The runtime dictionary MUST NOT contain:

- arrays as values
- nested objects as values
- duplicate keys with conflicting values

If ambiguity exists, it MUST be represented only in metadata outside the injected lookup map.

## 5. Canonical Runtime Artifact

### 5.1 Distribution Artifact

The compiled runtime distribution artifact SHOULD be a plain JSON object with the following fields:

- `dictionaryId`
- `sourceArtifact`
- `domainRoot`
- `sourceSnapshot`
- `collisionPolicy`
- `inputKey`
- `entriesMap`
- `droppedAmbiguousKeys`

`entriesMap` is the only field intended for injection into `NormalizationTask.inputs`.

### 5.2 Example Distribution Artifact

```json
{
  "dictionaryId": "urn:uuid:wikidata-finance-runtime-v1",
  "sourceArtifact": "urn:uuid:wikidata-finance-extract-v1",
  "domainRoot": "wd:Q600473",
  "sourceSnapshot": "wikidata-2026-04-01",
  "collisionPolicy": "strictDiscard",
  "inputKey": "abbreviationDictionary",
  "entriesMap": {
    "atm": "automated teller machine",
    "roi": "return on investment"
  },
  "droppedAmbiguousKeys": [
    {
      "shortNameKey": "mac",
      "candidates": [
        {
          "fullLabelValue": "macintosh",
          "sourceEntity": "http://www.wikidata.org/entity/Q622302"
        },
        {
          "fullLabelValue": "media access control",
          "sourceEntity": "http://www.wikidata.org/entity/Q507734"
        }
      ]
    }
  ]
}
```

## 6. Injection into the Core Pipeline

### 6.1 Injection Contract

At runtime, the core pipeline MUST inject only `entriesMap` into `NormalizationTask.inputs[inputKey]`.

Example:

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

### 6.2 Runtime Behavior

When `DictionaryExpand` executes:

- it performs exact token lookup against the injected object map
- if a token equals a retained key, the mapped string replaces that token
- the replacement string is tokenized canonically by the v2.1 runtime

No network access, live query, or database lookup is permitted during this phase.

## 7. Metadata and Diagnostics

The compiler SHOULD preserve ambiguity and discard information in distribution metadata, even though that metadata is not injected into `NormalizationTask.inputs`.

At minimum, `droppedAmbiguousKeys[]` SHOULD include:

- `shortNameKey`
- candidate `fullLabelValue`
- `sourceEntity`

This allows audits and future recompilation without weakening current runtime determinism.

## 8. Failure Modes

Compilation MUST fail if:

- the extraction artifact is invalid
- collision policy is anything other than `strictDiscard`
- the resulting `entriesMap` contains a non-string key or non-string value
- serialization cannot preserve deterministic key order

Compilation MAY succeed with an empty `entriesMap`, but only if:

- `collisionPolicy` is recorded
- `sourceArtifact` is recorded
- `sourceSnapshot` is recorded

## 9. Non-Goals

This specification does not define:

- how Wikidata is queried
- how extraction candidates are harvested
- array-preserving runtime ambiguity expansion

Those concerns belong to the extraction artifact spec or to a future runtime spec revision.
