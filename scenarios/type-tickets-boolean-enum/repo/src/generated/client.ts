interface Payload { available: boolean }
export async function getTypeTicketsBooleanEnum(id: string): Promise<Payload> {
  const response = await fetch(`https://api.example.test/tickets/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as Payload;
}
