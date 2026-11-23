import type { Definition } from '../types.js';

export default {
  id: 'rename-library-nested',
  category: 'field_renamed',
  difficulty: 'low',
  description: 'Nested author name',
  callPatterns: ['axios_static'],
  path: '/books/{id}',
  operationId: 'getRenameLibraryNested',
  before: {
    author: {
      name: 'Ursula',
    },
  },
  after: {
    author: {
      display_name: 'Ursula',
    },
  },
  schemaBefore: {
    type: 'object',
    required: ['author'],
    properties: {
      author: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string',
          },
        },
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['author'],
    properties: {
      author: {
        type: 'object',
        required: ['display_name'],
        properties: {
          display_name: {
            type: 'string',
          },
        },
      },
    },
  },
  source: {
    'src/consumer.ts':
      "import axios from 'axios';\ninterface Payload { author: { name: string } }\n\nexport async function readValue(id = '42') {\n  const { data } = await axios.get<Payload>(`https://api.example.test/books/${id}`);\n  return data.author.name;\n}\n",
  },
  expectedValue: 'Ursula',
  mapping: {
    kind: 'field_renamed',
    method: 'GET',
    path: '/books/{id}',
    location: 'response',
    old: 'author/name',
    new: 'author/display_name',
  },
} satisfies Definition;
