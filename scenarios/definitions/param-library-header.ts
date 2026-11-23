import type { Definition } from '../types.js';

export default {
  id: 'param-library-header',
  category: 'required_param_added',
  difficulty: 'moderate',
  description: 'Required library header',
  callPatterns: ['axios_static'],
  path: '/books',
  operationId: 'getParamLibraryHeader',
  before: {
    count: 4,
  },
  after: {
    count: 4,
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
      "import axios from 'axios';\ninterface Payload { count: number }\n\nexport async function readValue(id = '42') {\n  void id;\n  const { data } = await axios.get<Payload>(`https://api.example.test/books`);\n  return data.count;\n}\n",
  },
  expectedValue: 4,
  mapping: {
    kind: 'required_param_added',
    method: 'GET',
    path: '/books',
    param: 'x-library',
    in: 'header',
    default_value: 'central',
  },
  parameter: {
    name: 'x-library',
    in: 'header',
    value: 'central',
  },
} satisfies Definition;
