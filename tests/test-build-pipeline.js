#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");
var os = require("os");
var child_process = require("child_process");

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

var repoRoot = path.resolve(__dirname, "..");
var compileScript = path.join(repoRoot, "scripts", "compile-runtime-dictionary.js");
var extractSample = path.join(repoRoot, "artifacts", "examples", "finance-extract.sample.jsonld");
var expectedRuntime = path.join(repoRoot, "artifacts", "examples", "finance-runtime.sample.json");
var outPath = path.join(os.tmpdir(), "sting-normalizer-runtime-" + process.pid + ".json");

child_process.execFileSync(process.execPath, [
  compileScript,
  "--in", extractSample,
  "--out", outPath
], { stdio: "pipe" });

var actual = JSON.parse(fs.readFileSync(outPath, "utf8"));
var expected = JSON.parse(fs.readFileSync(expectedRuntime, "utf8"));

try { fs.unlinkSync(outPath); } catch (e) { /* ignore */ }

assertEq("dictionaryId derived from artifactId", actual.dictionaryId, expected.dictionaryId);
assertEq("sourceArtifact", actual.sourceArtifact, expected.sourceArtifact);
assertEq("domainRoot", actual.domainRoot, expected.domainRoot);
assertEq("sourceSnapshot", actual.sourceSnapshot, expected.sourceSnapshot);
assertEq("collisionPolicy", actual.collisionPolicy, expected.collisionPolicy);
assertEq("inputKey default", actual.inputKey, expected.inputKey);
assertEq("entriesMap retains unambiguous keys only", actual.entriesMap, expected.entriesMap);
assertEq("droppedAmbiguousKeys preserves collisions", actual.droppedAmbiguousKeys, expected.droppedAmbiguousKeys);

// End-to-end: the compiled entriesMap should plug straight into NormalizationTask.inputs
// and expand a known token like "atm" through the core library's DictionaryExpand rule.
var KeyNormalizer = require("../keyNormalizer.js");
var runner = KeyNormalizer.compile(
  {
    "@type": "PipelineDefinition",
    "rules": [
      {
        "@type": "Rule",
        "phase": "Enrichment",
        "order": 100,
        "ruleKind": "DictionaryExpand",
        "inputKey": actual.inputKey,
        "missingInputBehavior": "skipWithWarning"
      }
    ]
  },
  (function () {
    var inputs = {};
    inputs[actual.inputKey] = actual.entriesMap;
    return inputs;
  }())
);

assertEq("runtime dictionary compiles into a valid NormalizationTask input", runner.valid, true);
var r = runner.run("atm_fee");
assertEq("atm expands via compiled runtime dictionary", r.tokens, ["automated", "teller", "machine", "fee"]);

console.log("Build pipeline — " + pass + " passed, " + fail + " failed");
if (fail > 0) {
  console.log("");
  failures.forEach(function (f) {
    console.log("  " + f);
  });
  process.exit(1);
}
