import fs from "fs";
import path from "path";


export default async function handler(req, res) {
  const { token } = req.query;

  // Ask your gateway server to verify
  const response = await fetch("https://empiregate-api.onrender.com/api/merchant/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) return res.status(403).send("Invalid token");

  const merchant = await response.json();
  const merchantId = merchant.merchantId;

  if (!merchantId) {
    return res.status(400).send("Invalid merchant payload");
  }

  const allowedDomain = merchant.allowedDomain;


  // Apply CSP dynamically
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; frame-ancestors ${allowedDomain};`
  );

  // Serve static HTML
  const filePath = path.join(process.cwd(), "public", "empireGate.html");
  
  let html = fs.readFileSync(filePath, "utf8");

    // Inject merchant-specific variable (optional)
    html = html.replace(
      "</head>",
      `<script>window.ALLOWED_DOMAIN = "${allowedDomain}";</script></head>`
    );
    
  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(file);
}
