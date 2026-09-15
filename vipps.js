// ============================================================
// Vipps ePayment – integrert betaling i julebestillingen
// ============================================================
// Nøklene hentes fra portal.vipps.no -> Utvikler og legges inn som
// miljøvariabler i Coolify. Mangler én av dem, er Vipps avslått og
// julesiden faller tilbake til betaling til privat nummer.
//
//   VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY, VIPPS_MSN
//   VIPPS_TEST=true  -> testmiljøet (apitest.vipps.no)

const axios = require('axios');
const crypto = require('crypto');

const BASE = process.env.VIPPS_TEST === 'true' ? 'https://apitest.vipps.no' : 'https://api.vipps.no';

function vippsAktiv() {
  return !!(process.env.VIPPS_CLIENT_ID && process.env.VIPPS_CLIENT_SECRET &&
            process.env.VIPPS_SUBSCRIPTION_KEY && process.env.VIPPS_MSN);
}

const fellesHoder = () => ({
  'Ocp-Apim-Subscription-Key': process.env.VIPPS_SUBSCRIPTION_KEY,
  'Merchant-Serial-Number': process.env.VIPPS_MSN,
  'Vipps-System-Name': 'kakefrue',
  'Vipps-System-Version': '1.0.0',
  'Vipps-System-Plugin-Name': 'kakefrue-jul',
  'Vipps-System-Plugin-Version': '1.0.0'
});

let token = null, tokenUtloper = 0;
async function hentToken() {
  if (token && Date.now() < tokenUtloper) return token;
  const { data } = await axios.post(`${BASE}/accesstoken/get`, null, {
    headers: {
      ...fellesHoder(),
      client_id: process.env.VIPPS_CLIENT_ID,
      client_secret: process.env.VIPPS_CLIENT_SECRET
    }
  });
  token = data.access_token;
  // Fornyes fem minutter før den faktisk går ut
  tokenUtloper = Date.now() + (parseInt(data.expires_in, 10) - 300) * 1000;
  return token;
}

async function kall(metode, sti, body, idemNokkel) {
  const { data } = await axios({
    method: metode,
    url: `${BASE}/epayment/v1/payments${sti}`,
    data: body,
    headers: {
      ...fellesHoder(),
      Authorization: `Bearer ${await hentToken()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idemNokkel || crypto.randomUUID()
    }
  });
  return data;
}

// Vipps vil ha 47XXXXXXXX. Et ugyldig nummer sendes ikke med – da taster kunden det selv.
function vippsTelefon(tlf) {
  let d = String(tlf || '').replace(/\D/g, '');
  if (d.startsWith('0047')) d = d.slice(2);
  if (d.length === 8) d = '47' + d;
  return /^47[49]\d{7}$/.test(d) ? d : null;
}

async function opprettBetaling({ reference, belopKr, beskrivelse, returnUrl, telefon }) {
  const body = {
    amount: { currency: 'NOK', value: Math.round(belopKr * 100) },
    paymentMethod: { type: 'WALLET' },
    reference,
    returnUrl,
    userFlow: 'WEB_REDIRECT',
    paymentDescription: beskrivelse.slice(0, 100)
  };
  const nr = vippsTelefon(telefon);
  if (nr) body.customer = { phoneNumber: nr };
  return kall('post', '', body); // { redirectUrl, reference }
}

// state: CREATED | AUTHORIZED | ABORTED | EXPIRED | TERMINATED
const hentBetaling = (ref) => kall('get', `/${encodeURIComponent(ref)}`);

// Fast nøkkel per betaling: sjekker returside og admin samtidig, trekkes beløpet likevel bare én gang
const trekkBetaling = (ref, belopOre) =>
  kall('post', `/${encodeURIComponent(ref)}/capture`, { modificationAmount: { currency: 'NOK', value: belopOre } }, `trekk-${ref}`);

const kansellerBetaling = (ref) => kall('post', `/${encodeURIComponent(ref)}/cancel`, {});

const refunderBetaling = (ref, belopOre) =>
  kall('post', `/${encodeURIComponent(ref)}/refund`, { modificationAmount: { currency: 'NOK', value: belopOre } });

function vippsFeiltekst(err) {
  const d = err?.response?.data;
  return d?.detail || d?.title || d?.message || err.message || 'Ukjent Vipps-feil';
}

module.exports = {
  vippsAktiv, opprettBetaling, hentBetaling, trekkBetaling,
  kansellerBetaling, refunderBetaling, vippsFeiltekst
};
