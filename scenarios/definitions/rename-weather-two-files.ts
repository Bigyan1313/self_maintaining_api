import type { Definition } from '../types.js';

export default {
  id: 'rename-weather-two-files',
  category: 'field_renamed',
  difficulty: 'low',
  description: 'Station name read by two independent modules',
  callPatterns: ['fetch'],
  path: '/stations/{id}',
  operationId: 'getRenameWeatherTwoFiles',
  before: {
    station_name: 'Austin',
  },
  after: {
    display_name: 'Austin',
  },
  schemaBefore: {
    type: 'object',
    required: ['station_name'],
    properties: {
      station_name: {
        type: 'string',
      },
    },
  },
  schemaAfter: {
    type: 'object',
    required: ['display_name'],
    properties: {
      display_name: {
        type: 'string',
      },
    },
  },
  source: {
    'src/consumer.ts':
      "interface Payload { station_name: string }\n\nexport async function readValue(id = '42') {\n  const response = await fetch(`https://api.example.test/stations/${id}`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  return data.station_name;\n}\n",
    'src/summary.ts':
      "interface Payload { station_name: string }\n\nexport async function readSummary(id = '42') {\n  const response = await fetch(`https://api.example.test/stations/${id}`);\n  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n  const data = await response.json() as Payload;\n  return `Station: ${data.station_name}`;\n}\n",
  },
  expectedValue: 'Austin',
  mapping: {
    kind: 'field_renamed',
    method: 'GET',
    path: '/stations/{id}',
    location: 'response',
    old: 'station_name',
    new: 'display_name',
  },
} satisfies Definition;
