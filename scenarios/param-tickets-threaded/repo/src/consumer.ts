interface Payload { count: number }

export async function readValue(id = '42', region = 'us') {
  const response = await fetch(`https://api.example.test/events/${id}/tickets`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as Payload;
  void region; // v1 did not need region; v2 requires forwarding this caller value.
  return data.count;
}
