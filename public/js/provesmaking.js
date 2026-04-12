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

    const data = {
      full_name: document.getElementById('full_name').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      email: document.getElementById('email').value.trim() || null,
      preferred_date: document.getElementById('preferred_date').value || null,
      choice_1: document.getElementById('choice_1').value || null,
      choice_2: document.getElementById('choice_2').value || null,
      choice_3: document.getElementById('choice_3').value || null,
    };

    if (!data.full_name) {
      formError.textContent = 'Vennligst fyll inn navnet ditt.';
      formError.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send forespørsel';
      return;
    }
    if (!data.phone) {
      formError.textContent = 'Vennligst fyll inn telefonnummeret ditt.';
      formError.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send forespørsel';
      return;
    }
    if (!data.choice_1) {
      formError.textContent = 'Velg minst ett smaksønske.';
      formError.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send forespørsel';
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

      formWrap.style.display = 'none';
      formSuccess.classList.remove('hidden');
      formSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send forespørsel';
    }
  });
});
