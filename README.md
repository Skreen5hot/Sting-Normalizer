# Key Normalizer

Key Normalizer is a dependency-free JavaScript library for deterministic key normalization based on the hardened v2.1 specification in `Deterministic-Key-Normalization-Pipeline-v2.1.md`.

It ships as:

- `keyNormalizer.js`: a single self-contained library file
- `index.html`: a single self-contained Schema Title Normalizer (applies the library to JSON Schema)
- `demo.html`: a single self-contained Key Normalizer Lab for exploring raw `NormalizationTask` payloads

## Guarantees

- no runtime dependencies
- no network calls
- no consumer build step required
- browser and Node.js friendly distribution
- deterministic behavior for the same task payload in conforming ECMAScript 2023 runtimes

## Files

- `keyNormalizer.js`: library artifact
- `index.html`: Schema Title Normalizer — paste a JSON Schema and get titles derived from its keys
- `demo.html`: Key Normalizer Lab — paste a raw `NormalizationTask` JSON payload and inspect the result
- `tests/`: Node test suites (see the `Tests` section below)
- `scripts/`: build-time dictionary pipeline (Wikidata extraction + runtime compiler)
- `build/wikidata-domain.config.example.json`: example config for `extract-wikidata.js`
- `artifacts/examples/`: sample extraction artifact and compiled runtime dictionary
- `Deterministic-Key-Normalization-Pipeline-v2.1.md`: source specification

## Public API

The library exposes a browser global and a Node export:

```js
window.KeyNormalizer
```

```js
const KeyNormalizer = require("./keyNormalizer.js");
```

Available methods:

- `KeyNormalizer.normalize(task)`
- `KeyNormalizer.validateTask(task)`
- `KeyNormalizer.extractTokens(task)`
- `KeyNormalizer.tokenizeCanonical(value)`
- `KeyNormalizer.compile(pipelineDefinition, inputs?)` — returns a reusable `{ valid, errors, run(rawIdentifier) }` runner that validates and compiles the pipeline once
- `KeyNormalizer.getContext()`
- `KeyNormalizer.version`

## Browser Usage

```html
<script src="./keyNormalizer.js"></script>
<script>
  const task = {
    "@type": "NormalizationTask",
    "rawIdentifier": "getURLData_string",
    "pipeline": {
      "@type": "PipelineDefinition",
      "rules": [
        {
          "@type": "Rule",
          "phase": "Preparation",
          "order": 10,
          "ruleKind": "RegexReplace",
          "pattern": "_",
          "flags": "g",
          "replacement": " "
        },
        {
          "@type": "Rule",
          "phase": "Transformation",
          "order": 20,
          "ruleKind": "RegexReplace",
          "pattern": "([A-Z]+)([A-Z][a-z])",
          "flags": "g",
          "replacement": "$1 $2"
        },
        {
          "@type": "Rule",
          "phase": "Transformation",
          "order": 30,
          "ruleKind": "RegexReplace",
          "pattern": "([a-z0-9])([A-Z])",
          "flags": "g",
          "replacement": "$1 $2"
        },
        {
          "@type": "Rule",
          "phase": "Pruning",
          "order": 40,
          "ruleKind": "RegexReplace",
          "pattern": "\\b(string|int|bool|arr|obj)\\b",
          "flags": "giu",
          "replacement": ""
        }
      ]
    }
  };

  const result = window.KeyNormalizer.normalize(task);
  console.log(result.tokens);
</script>
```

## Node.js Usage

```js
const KeyNormalizer = require("./keyNormalizer.js");

const task = {
  "@type": "NormalizationTask",
  "rawIdentifier": "customer_primary_email",
  "pipeline": {
    "@type": "PipelineDefinition",
    "rules": [
      {
        "@type": "Rule",
        "phase": "Preparation",
        "order": 10,
        "ruleKind": "RegexReplace",
        "pattern": "_",
        "flags": "g",
        "replacement": " "
      }
    ]
  }
};

const result = KeyNormalizer.normalize(task);
console.log(result.normalizedString);
console.log(result.tokens);
```

## Result Shape

`normalize(task)` returns a JSON-LD object with:

- `@type: "SemanticTokenList"`
- `sourceIdentifier`
- `normalizedString`
- `tokens`
- `metadata.status`
- `metadata.executionEnvironment`
- `metadata.warnings`

Warnings are returned as structured objects. Invalid pipelines fail deterministically and do not partially execute.

## Naming Convention Coverage

The included harness examples cover:

- snake case
- kebab case
- camel case
- acronym-heavy camel case such as `getURLData`
- WikiWords / PascalCase
- degraded optional enrichment
- invalid duplicate rule order
- Unicode NFC normalization

## Running Locally

### Browser

- Open `index.html` for the Schema Title Normalizer (schema in, schema with `title` fields out).
- Open `demo.html` for the Key Normalizer Lab (raw `NormalizationTask` in, full result with metadata and warnings out).

Both pages load `keyNormalizer.js` from the same folder and run fully offline.

### Node.js

```bash
node -e "const k=require('./keyNormalizer.js'); console.log(k.version)"
```

### Tests

```bash
node tests/run-tests.js           # 12 fixture-based conformance tests + determinism check
node tests/test-compile.js        # compile() API tests
node tests/test-conformance.js    # spec-4.8 warning-shape assertions and public validateTask shape
node tests/test-build-pipeline.js # offline round-trip of scripts/compile-runtime-dictionary.js
```

## Current Scope

The current implementation supports the rule kinds defined in the hardened v2.1 spec:

- `RegexReplace`
- `DictionaryExpand`

If we add more rule kinds later, they should be treated as a new spec and implementation increment rather than informal behavior changes.

## Wikidata Build Pipeline

The runtime library is offline and dependency-free. Populating its `DictionaryExpand` inputs with real-world abbreviations is a separate, build-time concern. This repo ships two Node scripts that implement that split:

- `scripts/extract-wikidata.js` — reads a domain config, runs the canonical SPARQL query against a Wikidata endpoint, and writes a JSON-LD `DictionaryExtractionArtifact` (provenance-rich, ambiguity preserved). Specified by `Wikidata-Build-Time-Extraction-Artifact-Spec.md`.
- `scripts/compile-runtime-dictionary.js` — consumes that artifact offline and emits a strict-discard runtime dictionary with a flat `entriesMap` that is safe to drop into `NormalizationTask.inputs`. Specified by `Runtime-Abbreviation-Dictionary-Spec.md`.

The extraction step is the only component of the system that touches the network. The runtime library and the compile step are both fully offline.

Example usage:

```bash
# 1. Extraction (requires network; writes a JSON-LD artifact)
node ./scripts/extract-wikidata.js \
  --config ./build/wikidata-domain.config.example.json \
  --out ./artifacts/finance-extract.jsonld

# 2. Offline compilation into a runtime dictionary
node ./scripts/compile-runtime-dictionary.js \
  --in  ./artifacts/finance-extract.jsonld \
  --out ./artifacts/finance-runtime.json
```

Worked examples of both artifacts are checked into `artifacts/examples/`. `tests/test-build-pipeline.js` runs the compile step against those samples to verify the pipeline stays in sync with the spec.

Only the compiled `entriesMap` should ever be injected into `NormalizationTask.inputs`. The intermediate extraction artifact is provenance metadata for build tooling, not a runtime payload.
