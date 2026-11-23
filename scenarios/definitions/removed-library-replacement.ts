import type { Definition } from '../types.js';

export default {
  id: 'removed-library-replacement',
  category: 'endpoint_removed',
  difficulty: 'high',
  description: 'Availability endpoint moves',
  callPatterns: ['axios_static'],
  path: '/books/{id}/availability',
  operationId: 'getRemovedLibraryReplacement',
  before: {
    copies: 2,
  },
  after: {
    copies: 2,
  },
  schemaBefore: {
    type: 'object',
    required: ['copies'],
    properties: {
      copies: {
        type: 'number',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['copies'],
    properties: {
      copies: {
        type: 'number',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "import axios from 'axios';\ninterface Payload { copies: number }\n\nexport async function readValue(id = '42') {\n  const { data } = await axios.get<Payload>(`https://api.example.test/books/${id}/availability`);\n  return data.copies;\n}\n",
  },
  expectedValue: 2,
  mapping: {
    kind: 'endpoint_removed',
    method: 'GET',
    path: '/books/{id}/availability',
    replacement: {
      method: 'GET',
      path: '/availability/{id}',
    },
  },
  replacement: '/availability/{id}',
} satisfies Definition;
