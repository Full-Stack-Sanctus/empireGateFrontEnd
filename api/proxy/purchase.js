// /api/debug-proxy.js
export default async function handler(req, res) {
  try {
    const target = "https://empiregate-api.onrender.com/api/cards/detokenize";

    const response = await fetch(target, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" ? null : JSON.stringify(req.body),
    });

    const text = await response.text();
    res.status(response.status).send({ ok: response.ok, status: response.status, text });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
}
