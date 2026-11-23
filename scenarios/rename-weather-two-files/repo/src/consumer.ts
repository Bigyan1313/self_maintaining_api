interface Payload { station_name: string }

export async function readValue(id = '42') {
  const response = await fetch(`https://api.example.test/stations/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as Payload;
  return data.station_name;
}
