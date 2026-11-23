import { getRenameTicketsGenerated } from './generated/client.js';
interface Payload { event_name: string }

export async function readValue(id = '42') {
  const data = await getRenameTicketsGenerated(id);
  return data.event_name;
}
