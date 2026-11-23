import axios from 'axios';
interface Payload { author: { name: string } }

export async function readValue(id = '42') {
  const { data } = await axios.get<Payload>(`https://api.example.test/books/${id}`);
  return data.author.name;
}
