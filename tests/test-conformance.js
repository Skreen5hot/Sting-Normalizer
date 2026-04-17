#!/usr/bin/env node
"use strict";

var KeyNormalizer = require("../keyNormalizer.js");

var pass = 0;
var fail = 0;
var failures = [];

function assertEq(label, actual, expected) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a === b) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(label + "\n    expected " + b + "\n    got      " + a);
  }
}

function assertTrue(label, condition) {
  if (condition) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(label + "\n    expected truthy, got falsy");
  }
}

// --- Spec 4.8: MISSING_OPTIONAL_INPUT warning MUST include ruleId, phase, missingInput.
// This test uses a rule WITHOUT @id so the fallback label path is exercised.
var optionalResult = KeyNormalizer.normalize({
  "@type": "NormalizationTask",
  "rawIdentifier": "fname",
  "pipeline": {
    "@type": "PipelineDefinition",
    "rules": [
      {
        "@type": "Rule",
        "phase": "Enrichment",
        "order": 100,
        "ruleKind": "DictionaryExpand",
        "inputKey": "abbreviationDictionary",
        "missingInputBehavior": "skipWithWarning"
      }
    ]
  }
});

assertEq("optional-missing status", optionalResult.metadata.status, "succeeded");
assertEq("optional-missing warning count", optionalResult.metadata.warnings.length, 1);
var optWarning = optionalResult.metadata.warnings[0];
assertEq("optional-missing warningCode", optWarning.warningCode, "MISSING_OPTIONAL_INPUT");
assertTrue("optional-missing ruleId present (fallback)", typeof optWarning.ruleId === "string" && optWarning.ruleId.length > 0);
assertEq("optional-missing phase", optWarning.phase, "Enrichment");
assertEq("optional-missing missingInput", optWarning.missingInput, "abbreviationDictionary");

// Same, but WITH an @id — ruleId should equal the @id.
var optionalWithIdResult = KeyNormalizer.normalize({
  "@type": "NormalizationTask",
  "rawIdentifier": "fname",
  "pipeline": {
    "@type": "PipelineDefinition",
    "rules": [
      {
        "@id": "rule:expand",
        "@type": "Rule",
        "phase": "Enrichment",
        "order": 100,
        "ruleKind": "DictionaryExpand",
        "inputKey": "abbreviationDictionary",
        "missingInputBehavior": "skipWithWarning"
      }
    ]
  }
});
assertEq("optional-missing ruleId matches @id", optionalWithIdResult.metadata.warnings[0].ruleId, "rule:expand");

// --- MISSING_REQUIRED_INPUT path: failure result warning MUST also carry ruleId/phase/missingInput.
var requiredResult = KeyNormalizer.normalize({
  "@type": "NormalizationTask",
  "rawIdentifier": "fname",
  "pipeline": {
    "@type": "PipelineDefinition",
    "rules": [
      {
        "@type": "Rule",
        "phase": "Enrichment",
        "order": 100,
        "ruleKind": "DictionaryExpand",
        "inputKey": "abbreviationDictionary",
        "missingInputBehavior": "fail"
      }
    ]
  }
});

assertEq("required-missing status", requiredResult.metadata.status, "failed");
var reqWarning = requiredResult.metadata.warnings[0];
assertEq("required-missing warningCode", reqWarning.warningCode, "MISSING_REQUIRED_INPUT");
assertTrue("required-missing ruleId present", typeof reqWarning.ruleId === "string" && reqWarning.ruleId.length > 0);
assertEq("required-missing phase", reqWarning.phase, "Enrichment");
assertEq("required-missing missingInput", reqWarning.missingInput, "abbreviationDictionary");

// --- Public validateTask() shape: returns { valid, errors, sortedRules } — no leaked normalizedTask.
var validation = KeyNormalizer.validateTask({
  "@type": "NormalizationTask",
  "rawIdentifier": "foo",
  "pipeline": {
    "@type": "PipelineDefinition",
    "rules": [
      { "@type": "Rule", "phase": "Preparation", "order": 10, "ruleKind": "RegexReplace",
        "pattern": "a", "flags": "g", "replacement": "b" }
    ]
  }
});

assertEq("validateTask valid", validation.valid, true);
assertEq("validateTask errors", validation.errors, []);
assertTrue("validateTask sortedRules present", Array.isArray(validation.sortedRules) && validation.sortedRules.length === 1);
assertEq("validateTask no normalizedTask leak", validation.normalizedTask, undefined);
assertEq("validateTask return keys", Object.keys(validation).sort(), ["errors", "sortedRules", "valid"]);

// Invalid task still matches the trimmed shape.
var invalidValidation = KeyNormalizer.validateTask({
  "@type": "NormalizationTask",
  "rawIdentifier": "foo",
  "pipeline": {
    "@type": "PipelineDefinition",
    "rules": [
      { "@type": "Rule", "phase": "Preparation", "order": 10, "ruleKind": "RegexReplace",
        "pattern": "a", "flags": "g", "replacement": "b" },
      { "@type": "Rule", "phase": "Transformation", "order": 10, "ruleKind": "RegexReplace",
        "pattern": "c", "flags": "g", "replacement": "d" }
    ]
  }
});
assertEq("invalid validateTask valid", invalidValidation.valid, false);
assertTrue("invalid validateTask has errors", invalidValidation.errors.length > 0);
assertEq("invalid validateTask sortedRules empty", invalidValidation.sortedRules, []);
assertEq("invalid validateTask no normalizedTask leak", invalidValidation.normalizedTask, undefined);

console.log("KeyNormalizer spec conformance — " + pass + " passed, " + fail + " failed");
if (fail > 0) {
  console.log("");
  failures.forEach(function (f) {
    console.log("  " + f);
  });
  process.exit(1);
}
