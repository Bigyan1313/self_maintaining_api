interface Payload { workout_name: string }

export async function readValue(id = '42') {
  const response = await fetch(`https://api.example.test/workouts/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as Payload;
  const { workout_name } = data;
  return workout_name;
}
