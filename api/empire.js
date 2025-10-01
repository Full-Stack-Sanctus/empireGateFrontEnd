import fs from "fs";
import path from "path";
import fetch from "node-fetch";

export default async function handler(req, res) {
  const { token } = req.query;

  // Ask your gateway server to verify
  const response = await fetch("https://gateway.yourpay.com/verify-O2Auth-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) return res.status(403).send("Invalid token");

  const { allowedDomain } = await response.json();

  // Apply CSP dynamically
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; frame-ancestors ${allowedDomain};`
  );

  // Serve static HTML
  const filePath = path.join(process.cwd(), "public", "empireGate.html");
  const file = fs.readFileSync(filePath, "utf8");
  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(file);
}
