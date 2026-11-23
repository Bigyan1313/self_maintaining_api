import type { Definition } from '../types.js';

export default {
  id: 'param-fitness-axios-instance',
  category: 'required_param_added',
  difficulty: 'moderate',
  description: 'Required parameter on a configured axios instance',
  callPatterns: ['axios_instance'],
  path: '/workouts',
  operationId: 'getParamFitnessAxiosInstance',
  before: {
    count: 2,
  },
  after: {
    count: 2,
  },
  schemaBefore: {
    type: 'object',
    required: ['count'],
    properties: {
      count: {
        type: 'number',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['count'],
    properties: {
      count: {
        type: 'number',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "import axios from 'axios';\nconst api = axios.create({ baseURL: 'https://api.example.test' });\ninterface Payload { count: number }\n\nexport async function readValue(id = '42') {\n  void id;\n  const { data } = await api.get<Payload>(`/workouts`);\n  return data.count;\n}\n",
  },
  expectedValue: 2,
  mapping: {
    kind: 'required_param_added',
    method: 'GET',
    path: '/workouts',
    param: 'level',
    in: 'query',
    default_value: 'all',
  },
  parameter: {
    name: 'level',
    in: 'query',
    value: 'all',
    enum: ['all', 'beginner'],
  },
} satisfies Definition;
