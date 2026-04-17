# Key Normalizer

Key Normalizer is a dependency-free JavaScript library for deterministic key normalization based on the hardened v2.1 specification in `Deterministic-Key-Normalization-Pipeline-v2.1.md`.

It ships as:

- `keyNormalizer.js`: a single self-contained library file
- `index.html`: a single self-contained local test harness

## Guarantees

- no runtime dependencies
- no network calls
- no consumer build step required
- browser and Node.js friendly distribution
- deterministic behavior for the same task payload in conforming ECMAScript 2023 runtimes

## Files

- `keyNormalizer.js`: library artifact
- `index.html`: local browser playground with inline fixtures
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

Open `index.html` directly from disk. It loads `keyNormalizer.js` from the same folder and runs fully offline.

### Node.js

```bash
node -e "const k=require('./keyNormalizer.js'); console.log(k.version)"
```

## Current Scope

The current implementation supports the rule kinds defined in the hardened v2.1 spec:

- `RegexReplace`
- `DictionaryExpand`

If we add more rule kinds later, they should be treated as a new spec and implementation increment rather than informal behavior changes.
