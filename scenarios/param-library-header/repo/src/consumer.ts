import axios from 'axios';
interface Payload { count: number }

export async function readValue(id = '42') {
  void id;
  const { data } = await axios.get<Payload>(`https://api.example.test/books`);
  return data.count;
}
