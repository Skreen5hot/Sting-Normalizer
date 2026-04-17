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

var pipeline = {
  "@type": "PipelineDefinition",
  "@id": "urn:test:compile",
  "rules": [
    {
      "@type": "Rule",
      "phase": "Preparation",
      "order": 10,
      "ruleKind": "RegexReplace",
      "pattern": "([A-Z]+)([A-Z][a-z])",
      "flags": "g",
      "replacement": "$1 $2"
    },
    {
      "@type": "Rule",
      "phase": "Transformation",
      "order": 20,
      "ruleKind": "RegexReplace",
      "pattern": "([a-z0-9])([A-Z])",
      "flags": "g",
      "replacement": "$1 $2"
    }
  ]
};

var runner = KeyNormalizer.compile(pipeline);
assertEq("compile returns valid runner", runner.valid, true);

var r1 = runner.run("getURLData");
assertEq("runner.run tokens (acronym)", r1.tokens, ["get", "url", "data"]);
assertEq("runner.run status", r1.metadata.status, "succeeded");
assertEq("runner.run appliedPipeline", r1.metadata.appliedPipeline, "urn:test:compile");

var r2 = runner.run("first_name");
assertEq("runner reused on different input", r2.tokens, ["first", "name"]);

var r3 = runner.run("UserProfile");
assertEq("runner reused again", r3.tokens, ["user", "profile"]);

var r4 = runner.run("cafe\u0301_menu");
assertEq("runner NFC-normalizes rawIdentifier", r4.tokens, ["caf\u00e9", "menu"]);

var r5 = runner.run(12345);
assertEq("runner rejects non-string rawIdentifier", r5.metadata.status, "failed");

var invalidRunner = KeyNormalizer.compile({
  "@type": "PipelineDefinition",
  "rules": [
    { "@type": "Rule", "phase": "Preparation", "order": 10, "ruleKind": "RegexReplace",
      "pattern": "a", "flags": "g", "replacement": "b" },
    { "@type": "Rule", "phase": "Transformation", "order": 10, "ruleKind": "RegexReplace",
      "pattern": "c", "flags": "g", "replacement": "d" }
  ]
});
assertEq("compile surfaces validation failure", invalidRunner.valid, false);

var fallbackResult = invalidRunner.run("anything");
assertEq("invalid runner.run emits failed status", fallbackResult.metadata.status, "failed");
assertEq("invalid runner.run warning code", fallbackResult.metadata.warnings[0].warningCode, "INVALID_PIPELINE");

var enrichmentRunner = KeyNormalizer.compile(
  {
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
  },
  { "abbreviationDictionary": { "fname": "first name" } }
);

var r6 = enrichmentRunner.run("fname_lname");
assertEq("enrichment runner expands known abbreviation", r6.tokens, ["first", "name", "lname"]);

var a = JSON.stringify(KeyNormalizer.compile(pipeline).run("getURLData"));
var b = JSON.stringify(KeyNormalizer.compile(pipeline).run("getURLData"));
assertEq("compile + run is deterministic across runner instances", a, b);

console.log("KeyNormalizer.compile — " + pass + " passed, " + fail + " failed");
if (fail > 0) {
  console.log("");
  failures.forEach(function (f) {
    console.log("  " + f);
  });
  process.exit(1);
}
