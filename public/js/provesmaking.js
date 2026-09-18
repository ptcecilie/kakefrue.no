/* ============================================================
   Kakefrue — Prøvesmaking Form Logic
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('tastingForm');
  if (!form) return;

  const submitBtn = document.getElementById('submitBtn');
  const formSuccess = document.getElementById('formSuccess');
  const formError = document.getElementById('formError');
  const formWrap = document.getElementById('formWrap');

  // Set min date to today
  const dateInput = document.getElementById('preferred_date');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.min = today;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.add('hidden');
    formSuccess.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sender...';

    // Kake og fyll velges hver for seg (to nedtrekksmenyer pr. valg), men slas
    // sammen til én tekst her sa choice_1/2/3-feltene i databasen forblir uendret.
    const kombiner = (kakeId, fyllId) => {
      const kake = document.getElementById(kakeId).value;
      const fyll = document.getElementById(fyllId).value;
      if (kake && fyll) return `${kake} med ${fyll}`;
      return kake || fyll || null;
    };

    const data = {
      full_name: document.getElementById('full_name').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      email: document.getElementById('email').value.trim() || null,
      preferred_date: document.getElementById('preferred_date').value || null,
      choice_1: kombiner('choice_1_kake', 'choice_1_fyll'),
      choice_2: kombiner('choice_2_kake', 'choice_2_fyll'),
      choice_3: kombiner('choice_3_kake', 'choice_3_fyll'),
    };

    const gammelTekst = 'Gå til betaling – 500 kr';
    if (!data.full_name) {
      formError.textContent = 'Vennligst fyll inn navnet ditt.';
      formError.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = gammelTekst;
      return;
    }
    if (!data.phone) {
      formError.textContent = 'Vennligst fyll inn telefonnummeret ditt.';
      formError.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = gammelTekst;
      return;
    }
    if (!data.email) {
      formError.textContent = 'Vennligst fyll inn e-postadressen din.';
      formError.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = gammelTekst;
      return;
    }
    if (!data.choice_1) {
      formError.textContent = 'Velg minst ett smaksønske.';
      formError.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = gammelTekst;
      return;
    }

    try {
      const res = await fetch('/api/tastings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Noe gikk galt');

      if (json.vippsUrl) {
        submitBtn.textContent = 'Åpner Vipps...';
        formSuccess.classList.remove('hidden');
        window.location.href = json.vippsUrl;
        return;
      }
      throw new Error('Fikk ikke startet Vipps-betalingen');
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = gammelTekst;
    }
  });
});
