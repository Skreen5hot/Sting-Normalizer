#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");
var KeyNormalizer = require("../keyNormalizer.js");

var fixturesDir = path.join(__dirname, "fixtures");
var fixtureFiles = fs.readdirSync(fixturesDir)
  .filter(function (f) { return f.endsWith(".json"); })
  .sort();

var pass = 0;
var fail = 0;
var failures = [];

function jsonEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkFixture(fixture, result) {
  var errors = [];
  var expected = fixture.expected || {};

  if (expected.status !== undefined && result.metadata.status !== expected.status) {
    errors.push("metadata.status: expected " + JSON.stringify(expected.status) +
      ", got " + JSON.stringify(result.metadata.status));
  }
  if (expected.tokens !== undefined && !jsonEq(result.tokens, expected.tokens)) {
    errors.push("tokens: expected " + JSON.stringify(expected.tokens) +
      ", got " + JSON.stringify(result.tokens));
  }
  if (expected.normalizedString !== undefined &&
      result.normalizedString !== expected.normalizedString) {
    errors.push("normalizedString: expected " + JSON.stringify(expected.normalizedString) +
      ", got " + JSON.stringify(result.normalizedString));
  }
  if (expected.warningCodes !== undefined) {
    var actualCodes = (result.metadata.warnings || []).map(function (w) {
      return w.warningCode;
    });
    if (!jsonEq(actualCodes, expected.warningCodes)) {
      errors.push("warning codes: expected " + JSON.stringify(expected.warningCodes) +
        ", got " + JSON.stringify(actualCodes));
    }
  }
  if (expected.appliedPipeline !== undefined &&
      result.metadata.appliedPipeline !== expected.appliedPipeline) {
    errors.push("metadata.appliedPipeline: expected " + JSON.stringify(expected.appliedPipeline) +
      ", got " + JSON.stringify(result.metadata.appliedPipeline));
  }

  return errors;
}

console.log("KeyNormalizer v" + KeyNormalizer.version + " — " + fixtureFiles.length + " fixtures");
console.log("");

fixtureFiles.forEach(function (file) {
  var fixturePath = path.join(fixturesDir, file);
  var fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  var result = KeyNormalizer.normalize(fixture.task);
  var errors = checkFixture(fixture, result);

  if (errors.length === 0) {
    pass += 1;
    console.log("  PASS  " + file + "  " + fixture.name);
  } else {
    fail += 1;
    failures.push({ file: file, name: fixture.name, errors: errors });
    console.log("  FAIL  " + file + "  " + fixture.name);
  }
});

console.log("");

var determinismFailures = 0;
fixtureFiles.forEach(function (file) {
  var fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), "utf8"));
  var a = JSON.stringify(KeyNormalizer.normalize(fixture.task));
  var b = JSON.stringify(KeyNormalizer.normalize(fixture.task));
  if (a !== b) {
    determinismFailures += 1;
    failures.push({
      file: file,
      name: "determinism: " + fixture.name,
      errors: ["two invocations produced different JSON output"]
    });
  }
});

if (determinismFailures === 0) {
  console.log("  PASS  determinism: " + fixtureFiles.length + " fixtures stable across re-invocation");
} else {
  console.log("  FAIL  determinism: " + determinismFailures + " fixtures differed across re-invocation");
  fail += determinismFailures;
}

console.log("");
console.log(pass + " passed, " + fail + " failed");

if (fail > 0) {
  console.log("");
  console.log("Failure detail:");
  failures.forEach(function (f) {
    console.log("  " + f.file + " — " + f.name);
    f.errors.forEach(function (e) {
      console.log("    " + e);
    });
  });
  process.exit(1);
}
