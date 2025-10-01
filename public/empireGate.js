// Luhn check (digit-by-digit arithmetic)
function luhnCheck(pan) {
  const digits = pan.replace(/\D/g, '').split('').reverse().map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[i];
    if (i % 2 === 1) { // every second digit (since reversed)
      d = d * 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Formatting by groups (returns formatted string)
function formatPanByBrand(pan, brand) {
  const digits = pan.replace(/\D/g, '');
  if (brand === 'amex') {
    // AmEx: 4-6-5
    return digits.replace(/^(\d{1,4})(\d{1,6})?(\d{1,5})?/, (m, g1, g2 = '', g3 = '') => [g1, g2, g3].filter(Boolean).join(' '));
  } else {
    // default 4-4-4-4...
    return digits.replace(/(\d{1,4})/g, '$1 ').trim();
  }
}

// Minimal BIN map for demo (keep small on client; full lookups via API)
const BIN_MAP = {
  '4': { brand: 'visa' },
  '51': { brand: 'mastercard' },
  '55': { brand: 'mastercard' },
  '34': { brand: 'amex' },
  '37': { brand: 'amex' },
  // add known ranges or use a more complete client DB
};

function detectBinInfo(pan) {
  const digits = pan.replace(/\D/g, '');
  if (digits.length < 2) return null;
  // check longest prefix (up to 8)
  for (let len = 8; len >= 1; len--) {
    const prefix = digits.slice(0, len);
    if (BIN_MAP[prefix]) return BIN_MAP[prefix];
  }
  return null; // or call BIN API for unknown
}

const panInput = document.querySelector('#card-pan');
const cardBrandIcon = document.querySelector('#card-brand');
const submitBtn = document.querySelector('#submit');

// Update on input
panInput.addEventListener('input', (e) => {
  const raw = e.target.value;
  const binInfo = detectBinInfo(raw);
  const brand = binInfo ? binInfo.brand : 'unknown';

  // Format
  e.target.value = formatPanByBrand(raw, brand);

  // Show brand icon (example)
  cardBrandIcon.className = 'brand ' + brand;

  // Luhn validation
  const digitsOnly = raw.replace(/\D/g, '');
  if (digitsOnly.length >= 12) {
    if (luhnCheck(digitsOnly)) {
      panInput.classList.remove('invalid');
      panInput.classList.add('valid');
    } else {
      panInput.classList.remove('valid');
      panInput.classList.add('invalid');
    }
  } else {
    panInput.classList.remove('valid', 'invalid');
  }
});

async function tokenizeAndSendToParent({ pan, cvv, expiry }) {
  // Prepare body with client-side sanitized fields
  const body = {
    pan: pan.replace(/\s/g, ''), // raw PAN is sent only to tokenization endpoint
    cvv,
    expiry
  };

  // POST directly from iframe to gateway tokenization endpoint (HTTPS)
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
    // show error to user
    throw new Error('Tokenization failed');
  }

  const data = await resp.json(); // { token: 'tok_...', masked_pan: '...' }
  // Post message to parent — only send token & masked PAN
  window.parent.postMessage({
    type: 'card_token',
    token: data.token,
    maskedPAN: data.masked_pan
  }, 'https://merchant.example.com'); // merchant origin
}
