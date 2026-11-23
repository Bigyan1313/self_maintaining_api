import axios from 'axios';
const api = axios.create({ baseURL: 'https://api.example.test' });
interface Payload { count: number }

export async function readValue(id = '42') {
  void id;
  const { data } = await api.get<Payload>(`/workouts`);
  return data.count;
}
