interface Payload { count: number }

export async function readValue(id = '42') {
  void id;
  const response = await fetch(`https://api.example.test/orders`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as Payload;
  return data.count;
}
