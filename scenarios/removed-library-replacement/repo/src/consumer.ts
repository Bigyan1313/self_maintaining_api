import axios from 'axios';
interface Payload { copies: number }

export async function readValue(id = '42') {
  const { data } = await axios.get<Payload>(`https://api.example.test/books/${id}/availability`);
  return data.copies;
}
