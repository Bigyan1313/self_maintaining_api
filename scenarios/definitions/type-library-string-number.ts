import type { Definition } from '../types.js';

export default {
  id: 'type-library-string-number',
  category: 'field_type_changed',
  difficulty: 'moderate',
  description: 'Page count becomes numeric',
  callPatterns: ['axios_static'],
  path: '/books/{id}',
  operationId: 'getTypeLibraryStringNumber',
  before: {
    pages: '320',
  },
  after: {
    pages: 320,
  },
  schemaBefore: {
    type: 'object',
    required: ['pages'],
    properties: {
      pages: {
        type: 'string',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['pages'],
    properties: {
      pages: {
        type: 'number',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "import axios from 'axios';\ninterface Payload { pages: string }\n\nexport async function readValue(id = '42') {\n  const { data } = await axios.get<Payload>(`https://api.example.test/books/${id}`);\n  return data.pages.trim();\n}\n",
  },
  expectedValue: '320',
  mapping: {
    kind: 'field_type_changed',
    method: 'GET',
    path: '/books/{id}',
    field: 'pages',
    old_type: 'string',
    new_type: 'number',
    conversion: 'String(value)',
  },
} satisfies Definition;
