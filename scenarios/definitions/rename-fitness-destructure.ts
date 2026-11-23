import type { Definition } from '../types.js';

export default {
  id: 'rename-fitness-destructure',
  category: 'field_renamed',
  difficulty: 'low',
  description: 'Workout name read through destructuring',
  callPatterns: ['fetch'],
  path: '/workouts/{id}',
  operationId: 'getRenameFitnessDestructure',
  before: {
    workout_name: 'Tempo',
  },
  after: {
    label: 'Tempo',
  },
  schemaBefore: {
    type: 'object',
    required: ['workout_name'],
    properties: {
      workout_name: {
        type: 'string',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['label'],
    properties: {
      label: {
        type: 'string',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "interface Payload { workout_name: string }\n\nexport async function readValue(id = '42') {\n  const response = await fetch(`https://api.example.test/workouts/${id}`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  const { workout_name } = data;\n  return workout_name;\n}\n",
  },
  expectedValue: 'Tempo',
  mapping: {
    kind: 'field_renamed',
    method: 'GET',
    path: '/workouts/{id}',
    location: 'response',
    old: 'workout_name',
    new: 'label',
  },
} satisfies Definition;
