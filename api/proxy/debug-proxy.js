// /api/debug-proxy.js

export default async function handler(req, res) {
  try {
    const target = "https://empiregate-api.onrender.com/api/cards/tokenize";

    // 🧠 1. Forward only necessary headers
    const forwardedHeaders = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": req.headers.authorization || "",
    };

    // 🧠 2. Forward request
    const response = await fetch(target, {
      method: req.method,
      headers: forwardedHeaders,
      body: req.method === "GET" ? null : JSON.stringify(req.body),
    });

    // 🧠 3. Parse response safely
    const contentType = response.headers.get("content-type");
    let data;

    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // 🧠 4. Mirror the original status and content type
    res.status(response.status);
    res.setHeader("Content-Type", contentType || "application/json");

    // 🧠 5. Return response to client
    res.send(data);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: err.message });
  }
}
