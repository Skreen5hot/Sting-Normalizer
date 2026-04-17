#!/usr/bin/env node
"use strict";

// This test verifies the pure-logic pieces of the schema harness's Wikidata
// suggester without loading the HTML page: the acronym detection heuristic,
// the schema walker that finds candidate keys, and the SPARQL query builder.
// The actual fetch against query.wikidata.org is only exercised interactively
// in the browser.

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

// --- ported from index.html (schema harness) for isolated testing ---

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function detectAcronymSet(rawName) {
  var acronyms = new Set();
  if (typeof rawName !== "string" || !rawName) {
    return acronyms;
  }
  var working = rawName.normalize("NFC")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  var pieces = working.split(/[\p{Z}\p{P}]+/u);
  for (var i = 0; i < pieces.length; i += 1) {
    var piece = pieces[i];
    if (piece.length >= 2 && /[A-Z]/.test(piece) && piece === piece.toUpperCase()) {
      acronyms.add(piece.toLowerCase());
    }
  }
  return acronyms;
}

function collectSchemaKeys(schemaNode, keyName, accumulator) {
  if (keyName) {
    accumulator.push(keyName);
  }
  if (!isPlainObject(schemaNode)) {
    return;
  }

  ["properties", "$defs", "definitions", "dependentSchemas"].forEach(function (container) {
    if (!isPlainObject(schemaNode[container])) return;
    Object.keys(schemaNode[container]).forEach(function (childKey) {
      collectSchemaKeys(schemaNode[container][childKey], childKey, accumulator);
    });
  });

  if (isPlainObject(schemaNode.patternProperties)) {
    Object.keys(schemaNode.patternProperties).forEach(function (childKey) {
      collectSchemaKeys(schemaNode.patternProperties[childKey], null, accumulator);
    });
  }

  ["items", "additionalProperties", "unevaluatedProperties", "propertyNames",
   "contains", "if", "then", "else", "not", "additionalItems", "unevaluatedItems"]
  .forEach(function (childKey) {
    if (isPlainObject(schemaNode[childKey])) {
      collectSchemaKeys(schemaNode[childKey], null, accumulator);
    }
  });

  ["allOf", "anyOf", "oneOf", "prefixItems"].forEach(function (childKey) {
    if (Array.isArray(schemaNode[childKey])) {
      schemaNode[childKey].forEach(function (child) {
        collectSchemaKeys(child, null, accumulator);
      });
    }
  });

  if (Array.isArray(schemaNode.items)) {
    schemaNode.items.forEach(function (child) {
      collectSchemaKeys(child, null, accumulator);
    });
  }
}

function escapeSparqlLiteral(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function buildSparqlShortNameQuery(needles) {
  var values = needles.map(function (n) {
    return "\"" + escapeSparqlLiteral(n) + "\"";
  }).join(" ");
  return [
    "SELECT ?concept ?conceptLabel ?conceptDescription ?shortName WHERE {",
    "  VALUES ?needle { " + values + " }",
    "  ?concept wdt:P1813 ?shortName .",
    "  FILTER(STR(?shortName) = ?needle)",
    "  ?concept rdfs:label ?conceptLabel .",
    "  FILTER(LANG(?conceptLabel) = \"en\")",
    "  OPTIONAL {",
    "    ?concept schema:description ?conceptDescription .",
    "    FILTER(LANG(?conceptDescription) = \"en\")",
    "  }",
    "}",
    "LIMIT 500"
  ].join("\n");
}

// --- acronym detection heuristic ---

function setToSortedArray(s) {
  return Array.from(s).sort();
}

assertEq("DHS_email detects dhs", setToSortedArray(detectAcronymSet("DHS_email")), ["dhs"]);
assertEq("getURLData detects url", setToSortedArray(detectAcronymSet("getURLData")), ["url"]);
assertEq("XMLHttpRequest only detects xml", setToSortedArray(detectAcronymSet("XMLHttpRequest")), ["xml"]);
assertEq("ATM_fee detects atm", setToSortedArray(detectAcronymSet("ATM_fee")), ["atm"]);
assertEq("api_key detects nothing", setToSortedArray(detectAcronymSet("api_key")), []);
assertEq("first_name detects nothing", setToSortedArray(detectAcronymSet("first_name")), []);
assertEq("single-letter pieces ignored", setToSortedArray(detectAcronymSet("a_b")), []);
assertEq("ID (length 2) detected", setToSortedArray(detectAcronymSet("ID")), ["id"]);
assertEq("FAQ_section_XML detects faq and xml",
  setToSortedArray(detectAcronymSet("FAQ_section_XML")), ["faq", "xml"]);

// --- schema traversal ---

var sampleSchema = {
  "$id": "customer.schema.json",
  "type": "object",
  "properties": {
    "DHS_email": { "type": "string" },
    "getURLData": { "type": "string" },
    "nested": {
      "type": "object",
      "properties": {
        "ATM_fee": { "type": "number" },
        "api_key": { "type": "string" }
      }
    },
    "payments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "SWIFT_code": { "type": "string" }
        }
      }
    }
  },
  "$defs": {
    "addressRef": {
      "type": "object",
      "properties": {
        "ZIP_code": { "type": "string" }
      }
    }
  },
  "allOf": [
    {
      "type": "object",
      "properties": {
        "XML_payload": { "type": "string" }
      }
    }
  ]
};

var keys = [];
collectSchemaKeys(sampleSchema, null, keys);
assertEq("collectSchemaKeys finds every property name across nesting",
  keys.sort(),
  ["ATM_fee", "DHS_email", "SWIFT_code", "XML_payload", "ZIP_code", "addressRef",
   "api_key", "getURLData", "nested", "payments"]);

var union = new Set();
keys.forEach(function (k) {
  detectAcronymSet(k).forEach(function (a) { union.add(a); });
});
assertEq("acronym union across the schema",
  setToSortedArray(union),
  ["atm", "dhs", "swift", "url", "xml", "zip"]);

// --- SPARQL query builder ---

var query = buildSparqlShortNameQuery(["DHS", "FAQ"]);
assertEq("SPARQL query embeds needles as lexical VALUES",
  query.indexOf("VALUES ?needle { \"DHS\" \"FAQ\" }") !== -1, true);
assertEq("SPARQL query references P1813",
  query.indexOf("wdt:P1813 ?shortName") !== -1, true);
assertEq("SPARQL query has English label filter",
  query.indexOf("FILTER(LANG(?conceptLabel) = \"en\")") !== -1, true);
assertEq("SPARQL query escapes embedded quotes in needles",
  buildSparqlShortNameQuery(["A\"B"]).indexOf("\"A\\\"B\"") > -1, true);
assertEq("SPARQL query escapes backslashes in needles",
  buildSparqlShortNameQuery(["A\\B"]).indexOf("\"A\\\\B\"") > -1, true);

console.log("Wikidata suggester (logic) — " + pass + " passed, " + fail + " failed");
if (fail > 0) {
  console.log("");
  failures.forEach(function (f) {
    console.log("  " + f);
  });
  process.exit(1);
}
