interface Payload { customer_name: string }

export async function readValue(id = '42') {
  const response = await fetch(`https://api.example.test/customers/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as Payload;
  return data.customer_name;
}
