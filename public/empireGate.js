
// empireGate.js
// Assumes it's loaded inside an iframe served from your gateway domain (https://api.example-gateway.com).

// --- Minimal BIN map (demo) ---
const BIN_MAP = {
  '4': { brand: 'visa' },
  '51': { brand: 'mastercard' },
  '55': { brand: 'mastercard' },
  '34': { brand: 'amex' },
  '37': { brand: 'amex' },
};

// --- Helpers ---
function luhnCheck(pan) {
  const digits = pan.replace(/\D/g, '').split('').reverse().map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[i];
    if (i % 2 === 1) {
      d = d * 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function formatPanByBrand(pan, brand) {
  const digits = pan.replace(/\D/g, '');
  if (brand === 'amex') {
    return digits.replace(/^(\d{1,4})(\d{1,6})?(\d{1,5})?/, (m, g1, g2 = '', g3 = '') =>
      [g1, g2, g3].filter(Boolean).join(' ')
    );
  } else {
    return digits.replace(/(\d{1,4})/g, '$1 ').trim();
  }
}

function detectBinInfo(pan) {
  const digits = pan.replace(/\D/g, '');
  if (digits.length < 1) return null;
  // attempt longest prefix up to BIN_MAP key length
  const maxLen = Math.min(8, digits.length);
  for (let len = maxLen; len >= 1; len--) {
    const prefix = digits.slice(0, len);
    if (BIN_MAP[prefix]) return BIN_MAP[prefix];
  }
  return null;
}

function parseExpiry(expiryRaw) {
  // Accept formats like MM/YY, MMYY, M/YY, MYY
  const cleaned = expiryRaw.replace(/\s+/g, '').replace(/[^0-9]/g, '');
  if (cleaned.length === 3) { // MYY -> 0MYY
    return { month: cleaned.slice(0,1).padStart(2,'0'), year: '20' + cleaned.slice(1) };
  } else if (cleaned.length === 4) {
    return { month: cleaned.slice(0,2), year: '20' + cleaned.slice(2) };
  } else {
    return null;
  }
}

function isExpiryValid(expiryRaw) {
  const p = parseExpiry(expiryRaw);
  if (!p) return false;
  const mm = Number(p.month);
  const yyyy = Number(p.year);
  if (mm < 1 || mm > 12) return false;
  const now = new Date();
  const exp = new Date(yyyy, mm - 1, 1); // month is 0-indexed
  // expiry is valid if at least current month or later
  return exp >= new Date(now.getFullYear(), now.getMonth(), 1);
}

// --- DOM refs ---
const panInput = document.querySelector('#card-pan');
const expiryInput = document.querySelector('#expiry');
const cvvInput = document.querySelector('#cvv');
const brandEl = document.querySelector('#card-brand');
const submitBtn = document.querySelector('#submit');

const parentOrigin = window.ALLOWED_DOMAIN;

// --- State ---
let cardToken = null;
let tokenizing = false;
let merchantId = null;

// Button should start disabled until token is ready
submitBtn.disabled = true;

// --- Receive merchant ID from parent ---
window.addEventListener("message", (event) => {
  if (event.origin !== parentOrigin) return;
  // if (event.data?.merchantId) merchantId = event.data.merchantId;
});

// --- Helpers ---
function showBrand(brand) {
  brandEl.className = 'brand ' + (brand || 'unknown');
  brandEl.textContent = brand ? brand.toUpperCase() : '';
}

function setValidity(inputEl, ok) {
  inputEl.classList.toggle('valid', ok);
  inputEl.classList.toggle('invalid', !ok && inputEl.value.length > 0);
}

function validateAll() {
  const panDigits = panInput.value.replace(/\D/g, '');
  const binInfo = detectBinInfo(panInput.value);
  const brand = binInfo ? binInfo.brand : 'unknown';
  const panOk = panDigits.length >= 12 && luhnCheck(panDigits);
  const expiryOk = isExpiryValid(expiryInput.value);
  const cvvLen = (brand === 'amex') ? 4 : 3;
  const cvvOk = /^\d+$/.test(cvvInput.value) && (cvvInput.value.length === cvvLen);
  setValidity(panInput, panOk);
  setValidity(expiryInput, expiryOk);
  setValidity(cvvInput, cvvOk);
  return { panOk, expiryOk, cvvOk, brand, binInfo };
}

// --- Auto-tokenize when all valid ---
async function maybeAutoTokenize() {
  const { panOk, expiryOk, cvvOk } = validateAll();
  if (panOk && expiryOk && cvvOk && !cardToken && !tokenizing) {
    tokenizing = true;
    submitBtn.textContent = 'Tokenizing…';
    submitBtn.disabled = true;

    try {
      const panRaw = panInput.value;
      const expiryRaw = expiryInput.value;
      const cvvRaw = cvvInput.value;

      const data = await tokenizeCard({ pan: panRaw, cvv: cvvRaw, expiry: expiryRaw, parentOrigin });
      cardToken = data.token;

      // Notify parent window
      window.parent.postMessage({
        type: 'card_token',
        token: data.token,
        maskedPAN: data.masked_pan
      }, parentOrigin);

      console.log('Auto-tokenized successfully:', data.masked_pan);

      // ✅ Enable the Buy button only after tokenization success
      submitBtn.disabled = false;
      submitBtn.textContent = 'Buy';
    } catch (err) {
      console.error('Tokenization failed:', err);
      submitBtn.textContent = `Retry: ${err}`;
      submitBtn.disabled = true; // keep disabled until valid again
    } finally {
      tokenizing = false;
    }
  } else if (!panOk || !expiryOk || !cvvOk) {
    // Invalid input again → reset token
    cardToken = null;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Buy';
  }
}

// --- Actual tokenization request ---
// ✅ Helper to extract token from iframe URL query
function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

async function tokenizeCard({ pan, cvv, expiry }) {
  const token = getTokenFromUrl(); // extract merchant's token from URL

  if (!token) {
    throw new Error("Missing token in iframe URL");
  }

  const resp = await fetch("/api/proxy/tokenize", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      pan: pan.replace(/\s/g, ""), // remove spaces
      cvv,
      expiry
    })
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error("Tokenization failed:", errorText);
    throw new Error(`Tokenization failed: ${resp.status}`);
  }

  return resp.json();
}


// --- Input listeners ---
panInput.addEventListener('input', maybeAutoTokenize);
expiryInput.addEventListener('input', maybeAutoTokenize);
cvvInput.addEventListener('input', maybeAutoTokenize);

// --- Buy handler ---
submitBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!cardToken) return alert('Card not tokenized yet');
  // if (!merchantId) return alert('Merchant ID missing');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing…';

  try {
    const token = getTokenFromUrl(); // extract merchant's token from URL

    if (!token) {
       throw new Error("Missing token in iframe URL");
    }
  
    const resp = await fetch('/api/proxy/purchase', {
      method: 'POST',
      headers: { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json" 
          
      },
      body: JSON.stringify({ token: cardToken })
    });

    if (!resp.ok) throw new Error('Purchase failed');
    const data = await resp.json();
    
    alert('Purchase successful!\n' + JSON.stringify(data, null, 2));

    console.log('Buy result:', data);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Buy';
  }
});



// --- Prevent raw PAN leaks via postMessage or parent navigation ---
// Listen for parent pings or commands only from expected origin
document.addEventListener("DOMContentLoaded", () => {
  
  console.log("Allowed parent origin:", parentOrigin);

  // Example usage: only allow messages from that domain
  window.addEventListener("message", (event) => {
    if (event.origin !== parentOrigin) {
      console.warn("Blocked message from unauthorized origin:", event.origin);
      return;
    }

    console.log("Received valid message:", event.data);
  });
});