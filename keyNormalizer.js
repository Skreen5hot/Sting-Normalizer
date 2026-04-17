(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.KeyNormalizer = factory();
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = "0.1.0";
  var EXECUTION_ENVIRONMENT = "ECMAScript 2023";
  var CONTEXT = {
    "@context": {
      "ex": "http://example.org/vocab#",
      "NormalizationTask": "ex:NormalizationTask",
      "PipelineDefinition": "ex:PipelineDefinition",
      "Rule": "ex:Rule",
      "SemanticTokenList": "ex:SemanticTokenList",
      "Warning": "ex:Warning",
      "rawIdentifier": "ex:rawIdentifier",
      "pipeline": "ex:pipeline",
      "inputs": "ex:inputs",
      "rules": "ex:rules",
      "order": "ex:order",
      "phase": "ex:phase",
      "ruleKind": "ex:ruleKind",
      "pattern": "ex:pattern",
      "flags": "ex:flags",
      "replacement": "ex:replacement",
      "inputKey": "ex:inputKey",
      "missingInputBehavior": "ex:missingInputBehavior",
      "description": "ex:description",
      "sourceIdentifier": "ex:sourceIdentifier",
      "normalizedString": "ex:normalizedString",
      "tokens": "ex:tokens",
      "metadata": "ex:metadata",
      "warnings": "ex:warnings",
      "status": "ex:status",
      "appliedPipeline": "ex:appliedPipeline",
      "executionEnvironment": "ex:executionEnvironment",
      "warningCode": "ex:warningCode",
      "message": "ex:message",
      "severity": "ex:severity",
      "ruleId": "ex:ruleId",
      "missingInput": "ex:missingInput"
    }
  };
  var CANONICAL_PHASES = {
    "Preparation": true,
    "Transformation": true,
    "Pruning": true,
    "Enrichment": true
  };
  var RULE_KINDS = {
    "RegexReplace": true,
    "DictionaryExpand": true
  };
  var MISSING_INPUT_BEHAVIORS = {
    "skipWithWarning": true,
    "fail": true
  };
  var PHASE_ENRICHMENT = "Enrichment";

  function cloneContext() {
    return cloneNormalized(CONTEXT);
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function isString(value) {
    return typeof value === "string";
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function cloneNormalized(value) {
    var key;
    var normalizedKey;
    var copy;

    if (isString(value)) {
      return value.normalize("NFC");
    }

    if (Array.isArray(value)) {
      return value.map(cloneNormalized);
    }

    if (isPlainObject(value)) {
      copy = {};
      for (key in value) {
        if (hasOwn(value, key)) {
          normalizedKey = key.normalize("NFC");
          copy[normalizedKey] = cloneNormalized(value[key]);
        }
      }
      return copy;
    }

    return value;
  }

  function createValidationError(code, message, details) {
    return {
      code: code,
      message: message,
      details: details || {}
    };
  }

  function createWarning(code, message, severity, extras) {
    var warning = {
      "@type": "Warning",
      "warningCode": code,
      "message": message.normalize("NFC"),
      "severity": severity
    };

    if (extras) {
      if (extras.ruleId !== undefined) {
        warning.ruleId = extras.ruleId;
      }
      if (extras.phase !== undefined) {
        warning.phase = extras.phase;
      }
      if (extras.missingInput !== undefined) {
        warning.missingInput = extras.missingInput;
      }
    }

    return warning;
  }

  function buildMetadata(status, pipelineId, warnings) {
    var metadata = {
      "status": status,
      "executionEnvironment": EXECUTION_ENVIRONMENT,
      "warnings": warnings || []
    };

    if (pipelineId) {
      metadata.appliedPipeline = pipelineId;
    }

    return metadata;
  }

  function buildResult(sourceIdentifier, normalizedString, tokens, metadata) {
    return {
      "@context": cloneContext()["@context"],
      "@type": "SemanticTokenList",
      "sourceIdentifier": sourceIdentifier,
      "normalizedString": normalizedString,
      "tokens": tokens,
      "metadata": metadata
    };
  }

  function buildFailedResult(task, errors, options) {
    var normalizedIdentifier = "";
    var messages = [];
    var warningCode = "INVALID_PIPELINE";
    var pipelineId;
    var normalizedString = "";
    var index;

    options = options || {};

    if (task && isString(task.rawIdentifier)) {
      normalizedIdentifier = task.rawIdentifier.normalize("NFC");
    }

    normalizedString = options.normalizedString || normalizedIdentifier;

    if (task && task.pipeline && isString(task.pipeline["@id"])) {
      pipelineId = task.pipeline["@id"];
    }

    for (index = 0; index < errors.length; index += 1) {
      messages.push(errors[index].message);
    }

    if (options.warningCode) {
      warningCode = options.warningCode;
    }

    return buildResult(
      normalizedIdentifier,
      normalizedString,
      [],
      buildMetadata(
        "failed",
        pipelineId,
        [
          createWarning(
            warningCode,
            messages.join(" "),
            "error",
            options.warningExtras
          )
        ]
      )
    );
  }

  function validateDictionaryObject(value, inputKey) {
    var errors = [];
    var key;

    if (!isPlainObject(value)) {
      errors.push(createValidationError(
        "INVALID_DICTIONARY",
        "Dictionary input '" + inputKey + "' must be an object of string-to-string entries."
      ));
      return errors;
    }

    for (key in value) {
      if (hasOwn(value, key) && !isString(value[key])) {
        errors.push(createValidationError(
          "INVALID_DICTIONARY_ENTRY",
          "Dictionary input '" + inputKey + "' contains a non-string value for key '" + key + "'."
        ));
      }
    }

    return errors;
  }

  function prepareTask(task) {
    var normalizedTask = cloneNormalized(task);
    var errors = [];
    var rules;
    var sortedRules = [];
    var compiledStringRules = [];
    var enrichmentRules = [];
    var seenOrders = {};
    var maxStringRuleOrder = null;
    var compiledByRule = new Map();
    var index;
    var rule;
    var ruleKind;
    var compiled;
    var dictionaryErrors;
    var inputs;

    if (!isPlainObject(normalizedTask)) {
      return {
        valid: false,
        errors: [
          createValidationError("INVALID_TASK", "Normalization task must be an object.")
        ],
        normalizedTask: null,
        sortedRules: [],
        compiledStringRules: [],
        enrichmentRules: []
      };
    }

    if (!isString(normalizedTask.rawIdentifier)) {
      errors.push(createValidationError(
        "INVALID_RAW_IDENTIFIER",
        "Normalization task must include a string rawIdentifier."
      ));
    }

    if (!isPlainObject(normalizedTask.pipeline)) {
      errors.push(createValidationError(
        "MISSING_PIPELINE",
        "Normalization task must include a pipeline object."
      ));
    }

    if (normalizedTask.inputs !== undefined && !isPlainObject(normalizedTask.inputs)) {
      errors.push(createValidationError(
        "INVALID_INPUTS",
        "Normalization task inputs must be an object when provided."
      ));
    }

    if (!errors.length) {
      rules = normalizedTask.pipeline.rules;
      if (!Array.isArray(rules)) {
        errors.push(createValidationError(
          "INVALID_RULES",
          "PipelineDefinition must include a rules array."
        ));
      } else {
        inputs = normalizedTask.inputs;
        sortedRules = rules.slice(0);

        for (index = 0; index < sortedRules.length; index += 1) {
          rule = sortedRules[index];

          if (!isPlainObject(rule)) {
            errors.push(createValidationError(
              "INVALID_RULE",
              "Rule at index " + index + " must be an object."
            ));
            continue;
          }

          if (!CANONICAL_PHASES[rule.phase]) {
            errors.push(createValidationError(
              "INVALID_PHASE",
              "Rule '" + getRuleLabel(rule, index) + "' uses an unsupported phase."
            ));
          }

          if (!Number.isInteger(rule.order)) {
            errors.push(createValidationError(
              "INVALID_ORDER",
              "Rule '" + getRuleLabel(rule, index) + "' must use an integer order."
            ));
          } else if (hasOwn(seenOrders, String(rule.order))) {
            errors.push(createValidationError(
              "DUPLICATE_ORDER",
              "Pipeline validation failed: duplicate rule order " + rule.order + "."
            ));
          } else {
            seenOrders[String(rule.order)] = true;
          }

          ruleKind = rule.ruleKind || "RegexReplace";
          rule.ruleKind = ruleKind;

          if (!RULE_KINDS[ruleKind]) {
            errors.push(createValidationError(
              "INVALID_RULE_KIND",
              "Rule '" + getRuleLabel(rule, index) + "' uses unsupported ruleKind '" + ruleKind + "'."
            ));
            continue;
          }

          if (ruleKind === "RegexReplace") {
            if (rule.phase === PHASE_ENRICHMENT) {
              errors.push(createValidationError(
                "INVALID_RULE_PHASE",
                "RegexReplace rule '" + getRuleLabel(rule, index) + "' cannot use phase 'Enrichment'."
              ));
            }

            if (!isString(rule.pattern) || !isString(rule.flags) || !isString(rule.replacement)) {
              errors.push(createValidationError(
                "INVALID_REGEX_RULE",
                "RegexReplace rule '" + getRuleLabel(rule, index) + "' must define string pattern, flags, and replacement properties."
              ));
            } else {
              try {
                compiled = new RegExp(rule.pattern, rule.flags);
                compiledByRule.set(rule, compiled);
              } catch (error) {
                errors.push(createValidationError(
                  "INVALID_REGEX_RULE",
                  "RegexReplace rule '" + getRuleLabel(rule, index) + "' could not be compiled: " + error.message + "."
                ));
              }
            }
          }

          if (ruleKind === "DictionaryExpand") {
            if (rule.phase !== PHASE_ENRICHMENT) {
              errors.push(createValidationError(
                "INVALID_RULE_PHASE",
                "DictionaryExpand rule '" + getRuleLabel(rule, index) + "' must use phase 'Enrichment'."
              ));
            }

            if (!isString(rule.inputKey) || !isString(rule.missingInputBehavior)) {
              errors.push(createValidationError(
                "INVALID_DICTIONARY_RULE",
                "DictionaryExpand rule '" + getRuleLabel(rule, index) + "' must define string inputKey and missingInputBehavior properties."
              ));
            } else if (!MISSING_INPUT_BEHAVIORS[rule.missingInputBehavior]) {
              errors.push(createValidationError(
                "INVALID_MISSING_INPUT_BEHAVIOR",
                "DictionaryExpand rule '" + getRuleLabel(rule, index) + "' uses unsupported missingInputBehavior '" + rule.missingInputBehavior + "'."
              ));
            }

            if (isPlainObject(inputs) && hasOwn(inputs, rule.inputKey)) {
              dictionaryErrors = validateDictionaryObject(inputs[rule.inputKey], rule.inputKey);
              Array.prototype.push.apply(errors, dictionaryErrors);
            }
          }

          if (rule.phase !== PHASE_ENRICHMENT && Number.isInteger(rule.order)) {
            if (maxStringRuleOrder === null || rule.order > maxStringRuleOrder) {
              maxStringRuleOrder = rule.order;
            }
          }
        }

        sortedRules.sort(function (left, right) {
          return left.order - right.order;
        });

        for (index = 0; index < sortedRules.length; index += 1) {
          rule = sortedRules[index];
          if (rule.phase === PHASE_ENRICHMENT && maxStringRuleOrder !== null && rule.order <= maxStringRuleOrder) {
            errors.push(createValidationError(
              "INVALID_ENRICHMENT_ORDER",
              "Enrichment rule '" + getRuleLabel(rule, index) + "' must have an order greater than every non-Enrichment rule."
            ));
          }
        }

        if (!errors.length) {
          for (index = 0; index < sortedRules.length; index += 1) {
            rule = sortedRules[index];
            if (rule.phase === PHASE_ENRICHMENT) {
              enrichmentRules.push(rule);
            } else if (rule.ruleKind === "RegexReplace") {
              compiledStringRules.push({
                expression: compiledByRule.get(rule),
                replacement: rule.replacement
              });
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      normalizedTask: normalizedTask,
      sortedRules: errors.length === 0 ? sortedRules : [],
      compiledStringRules: compiledStringRules,
      enrichmentRules: enrichmentRules
    };
  }

  function validateTask(task) {
    var prep = prepareTask(task);
    return {
      valid: prep.valid,
      errors: prep.errors.slice(0),
      sortedRules: prep.sortedRules
    };
  }

  function getRuleLabel(rule, index) {
    if (rule && isString(rule["@id"]) && rule["@id"]) {
      return rule["@id"];
    }
    return "index " + index;
  }

  function tokenizeCanonical(value) {
    var pieces;

    if (!isString(value) || value.length === 0) {
      return [];
    }

    pieces = value.split(/[\p{Z}\p{P}]+/u);
    return pieces.filter(function (piece) {
      return piece.length > 0;
    }).map(function (piece) {
      return piece.toLowerCase();
    });
  }

  function applyCompiledStringRules(workingString, compiledStringRules) {
    var index;
    var entry;

    for (index = 0; index < compiledStringRules.length; index += 1) {
      entry = compiledStringRules[index];
      workingString = workingString.replace(entry.expression, entry.replacement);
    }

    return workingString;
  }

  function applyEnrichmentRules(tokens, rules, inputs, warnings) {
    var outputTokens = tokens.slice(0);
    var index;
    var tokenIndex;
    var rule;
    var ruleLabel;
    var dictionary;
    var replacementTokens;
    var replacementValue;
    var error;

    for (index = 0; index < rules.length; index += 1) {
      rule = rules[index];
      ruleLabel = getRuleLabel(rule, index);

      if (!inputs || !hasOwn(inputs, rule.inputKey)) {
        if (rule.missingInputBehavior === "skipWithWarning") {
          warnings.push(createWarning(
            "MISSING_OPTIONAL_INPUT",
            "Optional input '" + rule.inputKey + "' was not provided; rule '" + ruleLabel + "' was skipped.",
            "warning",
            {
              ruleId: ruleLabel,
              phase: rule.phase,
              missingInput: rule.inputKey
            }
          ));
          continue;
        }

        error = createValidationError(
          "MISSING_REQUIRED_INPUT",
          "Required input '" + rule.inputKey + "' was not provided for rule '" + ruleLabel + "'.",
          {
            ruleId: ruleLabel,
            phase: rule.phase,
            missingInput: rule.inputKey
          }
        );
        return {
          ok: false,
          error: error
        };
      }

      dictionary = inputs[rule.inputKey];

      for (tokenIndex = 0; tokenIndex < outputTokens.length; tokenIndex += 1) {
        if (!hasOwn(dictionary, outputTokens[tokenIndex])) {
          continue;
        }

        replacementValue = dictionary[outputTokens[tokenIndex]];
        replacementTokens = tokenizeCanonical(replacementValue);
        outputTokens.splice.apply(outputTokens, [tokenIndex, 1].concat(replacementTokens));
        tokenIndex += replacementTokens.length - 1;
      }
    }

    return {
      ok: true,
      tokens: outputTokens
    };
  }

  function executeCompiledPipeline(source, compiledStringRules, enrichmentRules, inputs, pipelineId, fallbackTask) {
    var warnings = [];
    var workingString;
    var tokens;
    var enrichmentResult;

    try {
      workingString = applyCompiledStringRules(source, compiledStringRules);
      tokens = tokenizeCanonical(workingString);
      enrichmentResult = applyEnrichmentRules(tokens, enrichmentRules, inputs, warnings);

      if (!enrichmentResult.ok) {
        return buildFailedResult(
          fallbackTask,
          [enrichmentResult.error],
          {
            warningCode: "MISSING_REQUIRED_INPUT",
            normalizedString: tokens.join(" "),
            warningExtras: enrichmentResult.error.details
          }
        );
      }

      tokens = enrichmentResult.tokens;

      return buildResult(
        source,
        tokens.join(" "),
        tokens,
        buildMetadata("succeeded", pipelineId, warnings)
      );
    } catch (error) {
      return buildFailedResult(
        fallbackTask,
        [
          createValidationError(
            "EXECUTION_ERROR",
            "Normalization failed during execution: " + error.message + "."
          )
        ],
        {
          warningCode: "EXECUTION_ERROR"
        }
      );
    }
  }

  function normalize(task) {
    var prep = prepareTask(task);
    var normalizedTask;
    var pipelineId;

    if (!prep.valid) {
      return buildFailedResult(prep.normalizedTask, prep.errors);
    }

    normalizedTask = prep.normalizedTask;
    pipelineId = normalizedTask.pipeline && normalizedTask.pipeline["@id"];

    return executeCompiledPipeline(
      normalizedTask.rawIdentifier,
      prep.compiledStringRules,
      prep.enrichmentRules,
      normalizedTask.inputs,
      pipelineId,
      normalizedTask
    );
  }

  function extractTokens(task) {
    return normalize(task).tokens.slice(0);
  }

  function getContext() {
    return cloneContext();
  }

  function compile(pipelineDefinition, inputs) {
    var templateTask = {
      "@type": "NormalizationTask",
      "rawIdentifier": "",
      "pipeline": pipelineDefinition
    };
    var prep;
    var normalizedInputs;
    var pipelineId;

    if (inputs !== undefined) {
      templateTask.inputs = inputs;
    }

    prep = prepareTask(templateTask);

    if (!prep.valid) {
      return {
        valid: false,
        errors: prep.errors.slice(0),
        run: function (rawIdentifier) {
          var fallbackTask = {
            "@type": "NormalizationTask",
            "rawIdentifier": isString(rawIdentifier) ? rawIdentifier : "",
            "pipeline": pipelineDefinition
          };
          return buildFailedResult(fallbackTask, prep.errors);
        }
      };
    }

    normalizedInputs = prep.normalizedTask.inputs;
    pipelineId = pipelineDefinition && pipelineDefinition["@id"];

    return {
      valid: true,
      errors: [],
      run: function (rawIdentifier) {
        var source;
        var fallbackTask;

        if (!isString(rawIdentifier)) {
          fallbackTask = {
            "@type": "NormalizationTask",
            "rawIdentifier": "",
            "pipeline": pipelineDefinition
          };
          return buildFailedResult(fallbackTask, [
            createValidationError(
              "INVALID_RAW_IDENTIFIER",
              "Normalization task must include a string rawIdentifier."
            )
          ]);
        }

        source = rawIdentifier.normalize("NFC");
        fallbackTask = {
          "@type": "NormalizationTask",
          "rawIdentifier": source,
          "pipeline": pipelineDefinition
        };

        return executeCompiledPipeline(
          source,
          prep.compiledStringRules,
          prep.enrichmentRules,
          normalizedInputs,
          pipelineId,
          fallbackTask
        );
      }
    };
  }

  return {
    version: VERSION,
    context: getContext(),
    getContext: getContext,
    validateTask: validateTask,
    tokenizeCanonical: tokenizeCanonical,
    normalize: normalize,
    extractTokens: extractTokens,
    compile: compile
  };
}));
