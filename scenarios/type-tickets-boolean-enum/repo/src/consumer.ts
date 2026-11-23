import { getTypeTicketsBooleanEnum } from './generated/client.js';
interface Payload { available: boolean }

export async function readValue(id = '42') {
  const data = await getTypeTicketsBooleanEnum(id);
  return data.available ? 'Book now' : 'Sold out';
}
