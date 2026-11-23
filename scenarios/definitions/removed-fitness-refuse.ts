import type { Definition } from '../types.js';

export default {
  id: 'removed-fitness-refuse',
  category: 'endpoint_removed',
  difficulty: 'high',
  description: 'Ranking removed without replacement',
  callPatterns: ['axios_instance'],
  path: '/sessions/{id}/ranking',
  operationId: 'getRemovedFitnessRefuse',
  before: {
    rank: 7,
  },
  after: {
    rank: 7,
  },
  schemaBefore: {
    type: 'object',
    required: ['rank'],
    properties: {
      rank: {
        type: 'number',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['rank'],
    properties: {
      rank: {
        type: 'number',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "import axios from 'axios';\nconst api = axios.create({ baseURL: 'https://api.example.test' });\ninterface Payload { rank: number }\n\nexport async function readValue(id = '42') {\n  const { data } = await api.get<Payload>(`/sessions/${id}/ranking`);\n  return data.rank;\n}\n",
  },
  expectedValue: 7,
} satisfies Definition;
