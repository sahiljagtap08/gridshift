# PolicyRule schema

This is the strict JSON Schema handed to Microsoft Foundry Structured Outputs. Foundry fills it from plain-language policy text; a human must confirm every field before the rule can be simulated, and only externally approved `ACTIVE` versions can drive Live Ops.

Missing operational values are reported in `ambiguities`, never invented.

## Version lifecycle

```
AI_INTERPRETED -> HUMAN_CONFIRMED -> SIMULATED -> EXTERNALLY_APPROVED -> ACTIVE -> RETIRED
```

## Example

```json
{
  "reduction_target": {
    "type": "percent_of_baseline",
    "value": 15
  },
  "duration_minutes": 120,
  "response_time_minutes": null,
  "trigger": {
    "type": "declared_grid_stress_event",
    "description": "declared grid stress / reliability event"
  },
  "protected_workload_classes": [
    "critical_inference"
  ],
  "flexible_workload_classes": [
    "training",
    "batch",
    "evaluation",
    "embeddings",
    "synthetic_data"
  ],
  "allowed_actions": [
    "suspend",
    "throttle",
    "defer"
  ],
  "operator_approval_required": true,
  "ambiguities": [
    {
      "field": "response_time_minutes",
      "reason": "policy does not define event notification lead time"
    }
  ],
  "summary": "Reduce non-critical load by 15% for up to 120 minutes during declared grid stress events, protecting critical inference; manual approval required."
}
```

## JSON Schema

```json
{
  "$defs": {
    "Ambiguity": {
      "properties": {
        "field": {
          "title": "Field",
          "type": "string"
        },
        "reason": {
          "title": "Reason",
          "type": "string"
        }
      },
      "required": [
        "field",
        "reason"
      ],
      "title": "Ambiguity",
      "type": "object"
    },
    "ReductionTarget": {
      "properties": {
        "type": {
          "enum": [
            "percent_of_baseline",
            "absolute_mw"
          ],
          "title": "Type",
          "type": "string"
        },
        "value": {
          "title": "Value",
          "type": "number"
        }
      },
      "required": [
        "type",
        "value"
      ],
      "title": "ReductionTarget",
      "type": "object"
    },
    "Trigger": {
      "properties": {
        "type": {
          "enum": [
            "declared_grid_stress_event",
            "utility_dispatch",
            "price_signal",
            "scheduled_window",
            "unspecified"
          ],
          "title": "Type",
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Description"
        }
      },
      "required": [
        "type"
      ],
      "title": "Trigger",
      "type": "object"
    }
  },
  "description": "Strict structured interpretation of a demand-flexibility rule.\n\nThis is the JSON Schema handed to Microsoft Foundry Structured Outputs.\nMissing operational values must be reported in `ambiguities`, never invented.",
  "properties": {
    "reduction_target": {
      "$ref": "#/$defs/ReductionTarget"
    },
    "duration_minutes": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "Null if the text does not specify",
      "title": "Duration Minutes"
    },
    "response_time_minutes": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "Null if the text does not specify",
      "title": "Response Time Minutes"
    },
    "trigger": {
      "$ref": "#/$defs/Trigger"
    },
    "protected_workload_classes": {
      "items": {
        "enum": [
          "critical_inference",
          "safety_systems",
          "platform_services",
          "training",
          "batch",
          "evaluation",
          "embeddings",
          "synthetic_data",
          "internal_inference"
        ],
        "type": "string"
      },
      "title": "Protected Workload Classes",
      "type": "array"
    },
    "flexible_workload_classes": {
      "items": {
        "enum": [
          "critical_inference",
          "safety_systems",
          "platform_services",
          "training",
          "batch",
          "evaluation",
          "embeddings",
          "synthetic_data",
          "internal_inference"
        ],
        "type": "string"
      },
      "title": "Flexible Workload Classes",
      "type": "array"
    },
    "allowed_actions": {
      "items": {
        "enum": [
          "suspend",
          "throttle",
          "defer"
        ],
        "type": "string"
      },
      "title": "Allowed Actions",
      "type": "array"
    },
    "operator_approval_required": {
      "default": true,
      "title": "Operator Approval Required",
      "type": "boolean"
    },
    "ambiguities": {
      "items": {
        "$ref": "#/$defs/Ambiguity"
      },
      "title": "Ambiguities",
      "type": "array"
    },
    "summary": {
      "description": "One sentence restating the rule as interpreted",
      "title": "Summary",
      "type": "string"
    }
  },
  "required": [
    "reduction_target",
    "trigger",
    "summary"
  ],
  "title": "PolicyRule",
  "type": "object"
}
```
