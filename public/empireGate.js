const urlParams = new URLSearchParams(window.location.search);
const PARENT_ORIGIN = urlParams.get('origin');

// Validate that this origin is actually allowed by your backend (optional fetch)
if (!/^https:\/\/(merchant\.example\.com|partner\.example\.org)$/.test(PARENT_ORIGIN)) {
  throw new Error("Unrecognized parent origin");
}



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


// --- UI helpers ---
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
  const panOk = panDigits.length >= 12 && luhnCheck(panDigits); // require 12+ digits
  const expiryOk = isExpiryValid(expiryInput.value);
  const cvvLen = (brand === 'amex') ? 4 : 3;
  const cvvOk = /^\d+$/.test(cvvInput.value) && (cvvInput.value.length === cvvLen);
  setValidity(panInput, panOk);
  setValidity(expiryInput, expiryOk);
  setValidity(cvvInput, cvvOk);
  submitBtn.disabled = !(panOk && expiryOk && cvvOk);
  return { panOk, expiryOk, cvvOk, brand, binInfo };
}

// --- Input wiring ---
// Keep simple formatting: format after typing ends (avoid moving caret complexity here)
let formatTimeout;
panInput.addEventListener('input', (e) => {
  clearTimeout(formatTimeout);
  const raw = e.target.value;
  const binInfo = detectBinInfo(raw);
  const brand = binInfo ? binInfo.brand : 'unknown';
  showBrand(brand);

  // Delay formatting to avoid janky caret movement while typing
  formatTimeout = setTimeout(() => {
    const formatted = formatPanByBrand(raw, brand);
    e.target.value = formatted;
  }, 200);

  validateAll();
});

expiryInput.addEventListener('input', () => validateAll());
cvvInput.addEventListener('input', () => validateAll());

// --- Tokenize + postMessage ---
async function tokenizeAndSendToParent({ pan, cvv, expiry }) {
  const body = {
    pan: pan.replace(/\s/g, ''), // raw PAN to tokenization endpoint only
    cvv,
    expiry
  };

  const resp = await fetch('https://api.example-gateway.com/tokenize', {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    // bubble up status text (do not include PAN in errors)
    const txt = await resp.text().catch(()=>null);
    throw new Error(txt || 'Tokenization failed');
  }

  const data = await resp.json(); // expected { token, masked_pan }
  // Only send token & masked PAN to parent
  window.parent.postMessage({
    type: 'card_token',
    token: data.token,
    maskedPAN: data.masked_pan
  }, PARENT_ORIGIN);
}

// --- Submit handler ---
submitBtn.addEventListener('click', async (ev) => {
  ev.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Tokenizing…';

  // Collect and sanitize
  const panRaw = panInput.value;
  const expiryRaw = expiryInput.value;
  const cvvRaw = cvvInput.value;

  try {
    const { panOk, expiryOk, cvvOk } = validateAll();
    if (!panOk || !expiryOk || !cvvOk) {
      throw new Error('Please correct card details before submitting.');
    }

    await tokenizeAndSendToParent({ pan: panRaw, cvv: cvvRaw, expiry: expiryRaw });
    // optionally show a success UI (but do not reveal token or PAN)
    submitBtn.textContent = 'Done';
  } catch (err) {
    console.error(err);
    alert('Payment error: ' + (err.message || 'Tokenization failed'));
    submitBtn.textContent = 'Tokenize';
  } finally {
    // re-enable after short delay
    setTimeout(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Tokenize';
    }, 800);
  }
});

// --- Prevent raw PAN leaks via postMessage or parent navigation ---
// Listen for parent pings or commands only from expected origin
window.addEventListener('message', (ev) => {
  if (ev.origin !== PARENT_ORIGIN) return;
  // handle any allowed commands (if you need)
});
