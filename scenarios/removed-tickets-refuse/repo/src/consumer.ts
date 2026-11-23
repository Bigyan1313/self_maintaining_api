import { getRemovedTicketsRefuse } from './generated/client.js';
interface Payload { price: number }

export async function readValue(id = '42') {
  const data = await getRemovedTicketsRefuse(id);
  return data.price;
}
