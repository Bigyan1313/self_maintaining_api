interface Payload { observed_at: number }

export async function readValue(id = '42') {
  const response = await fetch(`https://api.example.test/forecasts/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as Payload;
  return new Date(data.observed_at * 1000).toISOString();
}
