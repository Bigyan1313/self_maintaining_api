interface Payload { price: number }
export async function getRemovedTicketsRefuse(id: string): Promise<Payload> {
  const response = await fetch(`https://api.example.test/tickets/${id}/resale`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as Payload;
}
