import type { Definition } from '../types.js';

export default {
  id: 'param-weather-enum',
  category: 'required_param_added',
  difficulty: 'moderate',
  description: 'Enum query next to a path parameter',
  callPatterns: ['fetch'],
  path: '/stations/{id}/forecast',
  operationId: 'getParamWeatherEnum',
  before: {
    temperature: 21,
  },
  after: {
    temperature: 21,
  },
  schemaBefore: {
    type: 'object',
    required: ['temperature'],
    properties: {
      temperature: {
        type: 'number',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['temperature'],
    properties: {
      temperature: {
        type: 'number',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "interface Payload { temperature: number }\n\nexport async function readValue(id = '42') {\n  const response = await fetch(`https://api.example.test/stations/${id}/forecast`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  return data.temperature;\n}\n",
  },
  expectedValue: 21,
  mapping: {
    kind: 'required_param_added',
    method: 'GET',
    path: '/stations/{id}/forecast',
    param: 'units',
    in: 'query',
    default_value: 'metric',
  },
  parameter: {
    name: 'units',
    in: 'query',
    value: 'metric',
    enum: ['metric', 'imperial'],
  },
} satisfies Definition;
