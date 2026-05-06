export async function askAiMove(state, mode = 'heuristic') {
  const res = await fetch('http://localhost:4000/ai/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, mode }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'AI error');
  return data; // { ok:true, move, explanation, score }
}