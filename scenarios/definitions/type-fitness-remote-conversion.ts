import type { Definition } from '../types.js';

export default {
  id: 'type-fitness-remote-conversion',
  category: 'field_type_changed',
  difficulty: 'moderate',
  description: 'Distance formatting lives in another module',
  callPatterns: ['axios_static'],
  path: '/sessions/{id}',
  operationId: 'getTypeFitnessRemoteConversion',
  before: {
    distance: 5.25,
  },
  after: {
    distance: '5.25',
  },
  schemaBefore: {
    type: 'object',
    required: ['distance'],
    properties: {
      distance: {
        type: 'number',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['distance'],
    properties: {
      distance: {
        type: 'string',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "import axios from 'axios';\nimport { formatDistance } from './format.js';\ninterface Payload { distance: number }\n\nexport async function readValue(id = '42') {\n  const { data } = await axios.get<Payload>(`https://api.example.test/sessions/${id}`);\n  return formatDistance(data.distance);\n}\n",
    'src/format.ts':
      'export function formatDistance(distance: number): string {\n  return `${distance.toFixed(1)} km`;\n}\n',
  },
  expectedValue: '5.3 km',
  mapping: {
    kind: 'field_type_changed',
    method: 'GET',
    path: '/sessions/{id}',
    field: 'distance',
    old_type: 'number',
    new_type: 'string',
    conversion: 'Number(value)',
  },
} satisfies Definition;
