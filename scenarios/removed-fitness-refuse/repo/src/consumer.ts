import axios from 'axios';
const api = axios.create({ baseURL: 'https://api.example.test' });
interface Payload { rank: number }

export async function readValue(id = '42') {
  const { data } = await api.get<Payload>(`/sessions/${id}/ranking`);
  return data.rank;
}
