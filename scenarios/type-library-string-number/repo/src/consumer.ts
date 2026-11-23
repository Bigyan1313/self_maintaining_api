import axios from 'axios';
interface Payload { pages: string }

export async function readValue(id = '42') {
  const { data } = await axios.get<Payload>(`https://api.example.test/books/${id}`);
  return data.pages.trim();
}
