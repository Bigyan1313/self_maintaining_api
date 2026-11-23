import axios from 'axios';
import { formatDistance } from './format.js';
interface Payload { distance: number }

export async function readValue(id = '42') {
  const { data } = await axios.get<Payload>(`https://api.example.test/sessions/${id}`);
  return formatDistance(data.distance);
}
