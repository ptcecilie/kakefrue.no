/* ============================================================
   Kakefrue — Booking Flow Logic
   ============================================================ */

// ── State ──────────────────────────────────────────────────
const state = {
  currentStep: 1,
  customerId: null,
  bookingId: null,

  // Step 1
  fullName: '',
  phone: '',
  email: '',

  // Step 2
  selectedDate: null,
  availableDates: [],

  // Step 3
  occasion: '',
  occasionCustom: '',
  guestCount: null,

  // Step 4
  categories: [], // ['kake','cupcakes','standard','sesong']

  // Step 5
  allergens: [],

  // Step 6 — kake
  kake: { smak: '', etasjer: 1, fyll: [], utside: 'smørkrem', farge: '' },
  // Step 6 — cupcakes
  cupcakes: { count: 0, smak: '', topping: '', farge: '' },
  // Step 6 — standard
  standard: { kake: '', size: '24cm', notes: '' },
  // Step 6 — sesong quantities
  sesong: { kling:0, lefse:0, krumkaker:0, cookies:0, kransekakestenger:0, kransekake18:0, pepperkaker:0, mandelkake:0 },

  // Step 7
  designLevel: '',
  deliveryType: 'henting',
  deliveryAddress: '',
  deliveryZip: '',
  deliveryFee: 0,
};

const SESONG_PRICES = {
  kling:180, lefse:150, krumkaker:200, cookies:180,
  kransekakestenger:220, kransekake18:850, pepperkaker:150, mandelkake:350
};
const ALLERGEN_PRICES = { glutenfritt:150, 'nøtter':100, laktosefritt:100, melkefritt:150, egg:150 };
const DESIGN_PRICES = { enkel:0, standard:300, avansert:700 };
const KAKE_BASE = { 1:600, 2:1100, 3:1600 };
const CUPCAKE_PRICE = 45;
const DELIVERY_KR_PER_KM = 8;
const DELIVERY_MIN_FEE = 50; // minimumsavgift

// Postnummer → ca. km fra Porsgrunn 3901 (én vei, rundet)
const ZIP_DISTANCES = {
  // Porsgrunn
  '3901':0,'3902':0,'3903':0,'3904':0,'3905':0,'3906':0,'3907':0,'3908':0,'3909':0,
  // Grenland-nært
  '3910':4,'3911':6,'3912':5,'3913':8,'3914':10,'3915':12,'3916':9,'3917':10,
  '3918':16,'3919':14,'3920':18,'3921':20,'3925':22,'3929':24,
  '3930':28,'3950':38,'3960':44,
  '3970':30,'3980':38,'3990':60,
  '3700':18,'3710':22,'3720':20,'3730':24,'3740':30,'3750':34,'3760':38,
  // Kragerø (ca. 45 km)
  '3770':45,'3771':46,'3772':47,'3773':48,
  '3780':50,'3790':55,
  // Bø i Telemark (ca. 55 km)
  '3800':55,'3801':55,'3802':56,'3803':56,'3804':57,
  '3810':58,'3812':59,'3820':62,'3825':65,'3830':68,
  '3840':70,'3841':71,'3848':72,
  // Notodden (ca. 70 km)
  '3670':70,'3671':70,'3672':71,'3673':71,'3674':72,'3675':72,
  '3676':74,'3677':74,'3678':75,'3679':75,
  '3680':76,'3681':76,'3690':78,
  // Larvik (ca. 55 km)
  '3250':55,'3252':55,'3253':56,'3254':56,'3255':57,'3256':57,
  '3257':58,'3258':58,'3259':59,'3260':54,'3261':54,'3262':55,
  '3263':55,'3264':56,'3265':57,'3267':58,'3268':59,'3269':60,
  '3270':62,'3271':62,'3272':63,'3273':63,'3274':64,'3275':65,
  '3276':66,'3277':66,'3278':67,'3279':68,
  // Sandefjord (ca. 75 km)
  '3200':75,'3201':75,'3202':75,'3203':76,'3204':76,'3205':76,
  '3206':77,'3207':77,'3208':78,'3209':78,'3210':79,'3211':79,
  '3212':79,'3213':80,'3214':80,'3215':80,'3216':81,'3217':81,
  '3218':82,'3219':82,'3220':82,'3221':80,'3222':80,'3223':81,
  '3224':81,'3225':82,'3226':83,'3227':83,'3228':84,'3229':84,
  '3230':80,'3231':80,'3232':81,'3233':81,'3234':82,'3235':82,
  '3236':83,'3237':83,'3238':84,'3239':84,'3240':85,'3241':85,
  '3242':86,'3243':86,'3244':87,'3245':87,'3246':88,'3247':88,
};

function getDeliveryFee(zip) {
  const km = ZIP_DISTANCES[zip];
  if (km === undefined) return null; // ukjent postnummer
  if (km === 0) return 0;
  return Math.max(DELIVERY_MIN_FEE, Math.round(km * 2 * DELIVERY_KR_PER_KM));
}

// ── Utility ───────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function showError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideError(id) {
  const el = $(id);
  if (el) el.classList.add('hidden');
}
function formatDateNB(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('nb-NO', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

// ── Step Navigation ────────────────────────────────────────
function goToStep(n) {
  // Hide all steps
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  // Show target
  const target = $('step' + n) || $('step' + n.toString());
  if (target) target.classList.add('active');

  state.currentStep = n;

  // Update progress bar
  const fill = $('progressFill');
  if (fill) fill.style.width = ((n / 8) * 100) + '%';

  // Update step indicators
  document.querySelectorAll('.progress-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'done');
    if (s === n) el.classList.add('active');
    else if (s < n) el.classList.add('done');
  });

  // Scroll to top of booking card
  const card = $('bookingCard');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Step 1: Contact Info ───────────────────────────────────
$('step1Next').addEventListener('click', async () => {
  hideError('step1Error');
  const name = $('full_name').value.trim();
  const phone = $('phone').value.trim();
  const email = $('email').value.trim();

  if (!name) return showError('step1Error', 'Vennligst fyll inn navnet ditt.');
  if (!phone) return showError('step1Error', 'Vennligst fyll inn telefonnummeret ditt.');

  $('step1Next').disabled = true;
  $('step1Next').textContent = 'Lagrer...';

  try {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: name, phone, email: email || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Noe gikk galt');

    state.customerId = data.customer_id;
    state.fullName = name;
    state.phone = phone;
    state.email = email;

    goToStep(2);
    loadCalendar();
  } catch (err) {
    showError('step1Error', err.message);
  } finally {
    $('step1Next').disabled = false;
    $('step1Next').textContent = 'Neste →';
  }
});

// ── Step 2: Calendar ───────────────────────────────────────
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();

async function loadCalendar() {
  try {
    const res = await fetch('/api/available-dates');
    state.availableDates = await res.json();
    renderCalendar();
  } catch (e) {
    renderCalendar();
  }
}

function renderCalendar() {
  const now = new Date(calYear, calMonth, 1);
  const monthNames = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
  $('calMonth').textContent = monthNames[calMonth] + ' ' + calYear;

  // Day headers
  const dayHeaders = $('calendarDayHeaders');
  dayHeaders.innerHTML = ['Man','Tir','Ons','Tor','Fre','Lør','Søn'].map(d =>
    `<div class="calendar-day-header">${d}</div>`
  ).join('');

  // Build days
  const grid = $('calendarGrid');
  grid.innerHTML = '';

  const firstDay = new Date(calYear, calMonth, 1);
  let startDow = firstDay.getDay(); // 0=Sun
  startDow = startDow === 0 ? 6 : startDow - 1; // Mon=0

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  today.setHours(0,0,0,0);

  // Empty cells before first day
  for (let i = 0; i < startDow; i++) {
    grid.insertAdjacentHTML('beforeend', '<div class="calendar-day other-month"></div>');
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(calYear, calMonth, d);
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isAvail = state.availableDates.find(ad => ad.date && ad.date.substring(0,10) === dateStr);
    const isPast = dateObj < today;
    const isToday = dateObj.getTime() === today.getTime();
    const isSelected = state.selectedDate === dateStr;

    let cls = 'calendar-day';
    if (isAvail && !isPast) cls += ' available';
    if (isToday) cls += ' today';
    if (isSelected) cls += ' selected';

    const cell = document.createElement('div');
    cell.className = cls;
    cell.textContent = d;
    cell.dataset.date = dateStr;

    if (isAvail && !isPast) {
      cell.addEventListener('click', () => selectDate(dateStr, cell));
    }
    grid.appendChild(cell);
  }

  // Show info legend
  $('calendarInfo').style.display = state.availableDates.length ? 'block' : 'none';

  // Check if any dates this month
  const monthDates = state.availableDates.filter(ad => {
    if (!ad.date) return false;
    const d = new Date(ad.date);
    return d.getFullYear() === calYear && d.getMonth() === calMonth && new Date(ad.date) >= today;
  });
  const noAvail = $('noAvailDates');
  if (monthDates.length === 0) noAvail.classList.remove('hidden');
  else noAvail.classList.add('hidden');
}

function selectDate(dateStr, cell) {
  document.querySelectorAll('.calendar-day.selected').forEach(el => el.classList.remove('selected'));
  cell.classList.add('selected');
  state.selectedDate = dateStr;

  const display = $('selectedDateDisplay');
  const text = $('selectedDateText');
  display.style.display = 'block';
  text.textContent = formatDateNB(dateStr);
}

$('calPrev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});
$('calNext').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

$('step2Back').addEventListener('click', () => goToStep(1));
$('step2Next').addEventListener('click', () => {
  hideError('step2Error');
  if (!state.selectedDate) return showError('step2Error', 'Vennligst velg en dato.');
  goToStep(3);
});

// ── Step 3: Occasion ───────────────────────────────────────
document.querySelectorAll('[data-occasion]').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('[data-occasion]').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.occasion = card.dataset.occasion;
    const customWrap = $('occasionCustomWrap');
    if (state.occasion === 'annen') customWrap.classList.remove('hidden');
    else customWrap.classList.add('hidden');
  });
});

$('step3Back').addEventListener('click', () => goToStep(2));
$('step3Next').addEventListener('click', () => {
  if (!state.occasion) return alert('Velg en anledning.');
  state.occasionCustom = $('occasionCustom')?.value?.trim() || '';
  state.guestCount = parseInt($('guestCount').value) || null;
  goToStep(4);
});

// ── Step 4: Category ───────────────────────────────────────
document.querySelectorAll('[data-category]').forEach(card => {
  card.addEventListener('click', () => {
    const cat = card.dataset.category;
    if (cat === 'spesial') {
      sendSpecialRequest();
      return;
    }
    card.classList.toggle('selected');
    if (card.classList.contains('selected')) {
      if (!state.categories.includes(cat)) state.categories.push(cat);
    } else {
      state.categories = state.categories.filter(c => c !== cat);
    }
  });
});

async function sendSpecialRequest() {
  const confirmed = confirm('Send en spesialbestillingsforespørsel? Vi tar kontakt med deg innen 1–2 virkedager.');
  if (!confirmed) return;
  try {
    await fetch('/api/special-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: state.fullName, phone: state.phone, email: state.email, message: 'Spesialbestilling via bookingskjema' })
    });
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    $('stepSpecial').classList.add('active');
    $('bookingProgress').style.display = 'none';
  } catch (e) {
    alert('Noe gikk galt. Kontakt oss direkte på post@kakefrue.no');
  }
}

$('step4Back').addEventListener('click', () => goToStep(3));
$('step4Next').addEventListener('click', () => {
  hideError('step4Error');
  if (!state.categories.length) return showError('step4Error', 'Velg minst én kategori.');
  // Show relevant substeps
  document.querySelectorAll('.sub-step').forEach(s => s.classList.remove('active'));
  state.categories.forEach(cat => {
    const sub = $('substep-' + cat);
    if (sub) sub.classList.add('active');
  });
  goToStep(5);
});

// ── Step 5: Allergens ─────────────────────────────────────
document.querySelectorAll('.checkbox-label[data-allergen]').forEach(label => {
  label.addEventListener('click', () => {
    label.classList.toggle('checked');
    const val = label.dataset.allergen;
    if (label.classList.contains('checked')) {
      if (!state.allergens.includes(val)) state.allergens.push(val);
    } else {
      state.allergens = state.allergens.filter(a => a !== val);
    }
  });
});

$('step5Back').addEventListener('click', () => goToStep(4));
$('step5Next').addEventListener('click', () => goToStep(6));

// ── Step 6: Details ───────────────────────────────────────

// Checkbox helpers for fill
function initCheckboxGroup(container) {
  container.querySelectorAll('.checkbox-label').forEach(label => {
    label.addEventListener('click', () => {
      label.classList.toggle('checked');
    });
  });
}
const fillGrid = $('fillGrid');
if (fillGrid) initCheckboxGroup(fillGrid);

// Etasje selector
document.querySelectorAll('[data-etasje]').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('[data-etasje]').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.kake.etasjer = parseInt(card.dataset.etasje);
  });
});

// Standard size selector
document.querySelectorAll('[data-standardsize]').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('[data-standardsize]').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.standard.size = card.dataset.standardsize;
  });
});

// Sesong quantity buttons
document.querySelectorAll('.qty-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sesong;
    const action = btn.dataset.action;
    if (action === 'plus') state.sesong[key] = (state.sesong[key] || 0) + 1;
    if (action === 'minus') state.sesong[key] = Math.max(0, (state.sesong[key] || 0) - 1);
    $('qty-' + key).textContent = state.sesong[key];
  });
});

$('step6Back').addEventListener('click', () => goToStep(5));
$('step6Next').addEventListener('click', () => {
  // Collect step 6 data
  if (state.categories.includes('kake')) {
    state.kake.smak = $('kakeSmak').value;
    state.kake.fyll = Array.from($('fillGrid').querySelectorAll('.checkbox-label.checked')).map(l => l.querySelector('input').value);
    state.kake.utside = $('kakeUtside').value;
    state.kake.farge = $('kakeColor').value;
    if (!state.kake.smak) return alert('Velg kakesmak.');
    if (!state.kake.fyll.length) return alert('Velg minst ett fyll.');
  }
  if (state.categories.includes('cupcakes')) {
    state.cupcakes.count = parseInt($('cupcakeCount').value) || 0;
    state.cupcakes.smak = $('cupcakeSmak').value;
    state.cupcakes.topping = $('cupcakeTopping').value;
    state.cupcakes.farge = $('cupcakeColor').value;
    if (!state.cupcakes.count) return alert('Oppgi antall cupcakes.');
  }
  if (state.categories.includes('standard')) {
    state.standard.kake = $('standardKake').value;
    state.standard.notes = $('standardNotes').value;
    if (!state.standard.kake) return alert('Velg standardkake.');
  }

  // Skip design step for sesong-only
  if (state.categories.length === 1 && state.categories[0] === 'sesong') {
    state.designLevel = 'enkel';
    buildSummary();
    goToStep(8);
  } else {
    goToStep(7);
  }
});

// ── Step 7: Design & Delivery ─────────────────────────────
document.querySelectorAll('[data-delivery]').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('[data-delivery]').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.deliveryType = card.dataset.delivery;
    state.deliveryFee = 0;
    const addrWrap = $('deliveryAddressWrap');
    if (state.deliveryType === 'levering') addrWrap.classList.remove('hidden');
    else { addrWrap.classList.add('hidden'); $('deliveryCostResult').style.display = 'none'; }
  });
});

// Live km-kalkulator
$('deliveryZip') && $('deliveryZip').addEventListener('input', () => {
  const zip = $('deliveryZip').value.trim();
  const resultEl = $('deliveryCostResult');
  const textEl = $('deliveryCostText');
  const labelEl = $('deliveryPriceLabel');
  if (zip.length === 4) {
    const fee = getDeliveryFee(zip);
    if (fee === null) {
      textEl.textContent = 'Ukjent postnummer – leveringspris avtales direkte.';
      resultEl.style.display = 'block';
      state.deliveryFee = 0;
      if (labelEl) labelEl.textContent = 'kr 8,- per km';
    } else if (fee === 0) {
      textEl.textContent = '🎉 Gratis levering – du er i Porsgrunn!';
      resultEl.style.display = 'block';
      state.deliveryFee = 0;
      if (labelEl) labelEl.textContent = 'Gratis';
    } else {
      const km = ZIP_DISTANCES[zip];
      textEl.textContent = `📍 Ca. ${km} km fra Porsgrunn (begge veier: ${km*2} km) → leveringskostnad: kr ${fee},-`;
      resultEl.style.display = 'block';
      state.deliveryFee = fee;
      if (labelEl) labelEl.textContent = `+ kr ${fee},-`;
    }
  } else {
    resultEl.style.display = 'none';
    state.deliveryFee = 0;
    if (labelEl) labelEl.textContent = 'kr 8,- per km';
  }
});

document.querySelectorAll('.design-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.design-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.designLevel = card.dataset.design;
  });
});

$('step7Back').addEventListener('click', () => {
  if (state.categories.length === 1 && state.categories[0] === 'sesong') goToStep(5);
  else goToStep(6);
});
$('step7Next').addEventListener('click', () => {
  hideError('step7Error');
  if (!state.designLevel) return showError('step7Error', 'Velg et designnivå.');
  if (state.deliveryType === 'levering') {
    state.deliveryZip = $('deliveryZip').value.trim();
    state.deliveryAddress = $('deliveryAddress').value.trim();
    if (!state.deliveryZip || state.deliveryZip.length !== 4) return showError('step7Error', 'Fyll inn postnummer (4 siffer).');
    if (!state.deliveryAddress) return showError('step7Error', 'Fyll inn leveringsadresse.');
  }
  buildSummary();
  goToStep(8);
});

// ── Summary Builder ────────────────────────────────────────
function calcTotal() {
  let total = 0;
  const breakdown = [];

  if (state.categories.includes('kake')) {
    const base = KAKE_BASE[state.kake.etasjer] || 600;
    total += base;
    breakdown.push({ label: `Kake (${state.kake.etasjer} etasje${state.kake.etasjer > 1 ? 'r' : ''})`, price: base });
  }
  if (state.categories.includes('cupcakes')) {
    const cp = state.cupcakes.count * CUPCAKE_PRICE;
    total += cp;
    breakdown.push({ label: `Cupcakes (${state.cupcakes.count} stk × kr 45)`, price: cp });
  }
  if (state.categories.includes('standard')) {
    const sp = 450; // avg
    total += sp;
    breakdown.push({ label: `Standardkake (${state.standard.kake || '?'})`, price: sp });
  }
  if (state.categories.includes('sesong')) {
    let sesongTotal = 0;
    for (const [key, qty] of Object.entries(state.sesong)) {
      if (qty > 0) {
        const price = SESONG_PRICES[key] * qty;
        sesongTotal += price;
        breakdown.push({ label: `${key} × ${qty}`, price });
      }
    }
    total += sesongTotal;
  }

  // Design
  const designPrice = DESIGN_PRICES[state.designLevel] || 0;
  if (designPrice > 0) {
    total += designPrice;
    breakdown.push({ label: `Design (${state.designLevel})`, price: designPrice });
  }

  // Allergens
  state.allergens.forEach(a => {
    const ap = ALLERGEN_PRICES[a] || 0;
    if (ap > 0) {
      total += ap;
      breakdown.push({ label: `Allergen: ${a}`, price: ap });
    }
  });

  // Delivery
  if (state.deliveryType === 'levering' && state.deliveryFee > 0) {
    total += state.deliveryFee;
    breakdown.push({ label: `Levering (${state.deliveryZip})`, price: state.deliveryFee });
  }

  return { total, breakdown, deposit: Math.ceil(total * 0.3) };
}

function buildSummary() {
  $('sum-name').textContent = state.fullName;
  $('sum-phone').textContent = state.phone;
  $('sum-email').textContent = state.email || '—';
  $('sum-date').textContent = formatDateNB(state.selectedDate);
  $('sum-occasion').textContent = state.occasion + (state.occasionCustom ? ': ' + state.occasionCustom : '');
  $('sum-guests').textContent = state.guestCount ? state.guestCount + ' gjester' : '—';
  $('sum-delivery').textContent = state.deliveryType === 'levering'
    ? `Levering til ${state.deliveryZip} ${state.deliveryAddress}${state.deliveryFee > 0 ? ' (kr ' + state.deliveryFee + ',-)' : ' (gratis)'}`
    : 'Henting i Porsgrunn';

  // Items summary
  const itemsEl = $('sum-items');
  const itemLines = [];
  if (state.categories.includes('kake')) itemLines.push(`Kake: ${state.kake.smak}, ${state.kake.etasjer} etasje(r), fyll: ${state.kake.fyll.join(' + ')}`);
  if (state.categories.includes('cupcakes')) itemLines.push(`Cupcakes: ${state.cupcakes.count} stk, ${state.cupcakes.smak}, topping: ${state.cupcakes.topping}`);
  if (state.categories.includes('standard')) itemLines.push(`Standardkake: ${state.standard.kake}`);
  if (state.categories.includes('sesong')) {
    const sesongList = Object.entries(state.sesong).filter(([,q]) => q > 0).map(([k,q]) => `${k} × ${q}`).join(', ');
    if (sesongList) itemLines.push(`Sesong: ${sesongList}`);
  }
  itemsEl.innerHTML = itemLines.map(l => `<div class="summary-row"><span>${l}</span></div>`).join('') || '<div class="summary-row"><span>—</span></div>';

  // Prices
  const { total, breakdown, deposit } = calcTotal();
  $('sum-price-rows').innerHTML = breakdown.map(b =>
    `<div class="summary-row"><span>${b.label}</span><strong>kr ${b.price.toLocaleString('nb-NO')},-</strong></div>`
  ).join('');
  $('sum-total').textContent = `kr ${total.toLocaleString('nb-NO')},-`;
  $('sum-deposit').innerHTML = `<strong>kr ${deposit.toLocaleString('nb-NO')},-</strong>`;

  state._total = total;
  state._deposit = deposit;
}

// Payment method selector (Vipps disabled)
document.querySelectorAll('[data-payment]').forEach(card => {
  card.addEventListener('click', () => {
    if (card.dataset.payment === 'vipps') return;
    document.querySelectorAll('[data-payment]').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
  });
});

// ── Step 8: Confirm & Pay ──────────────────────────────────
$('step8Back').addEventListener('click', () => {
  if (state.categories.length === 1 && state.categories[0] === 'sesong') goToStep(6);
  else goToStep(7);
});

$('step8Pay').addEventListener('click', async () => {
  hideError('step8Error');
  $('step8Pay').disabled = true;
  $('step8Pay').textContent = 'Oppretter bestilling...';

  try {
    // Build items array
    const items = [];
    if (state.categories.includes('kake')) {
      items.push({ category: 'kake', details: state.kake });
    }
    if (state.categories.includes('cupcakes')) {
      items.push({ category: 'cupcakes', details: state.cupcakes });
    }
    if (state.categories.includes('standard')) {
      items.push({ category: 'standard', details: state.standard });
    }
    if (state.categories.includes('sesong')) {
      items.push({ category: 'sesong', details: state.sesong });
    }

    // Create booking
    const bookingRes = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: state.customerId,
        booking_date: state.selectedDate,
        occasion: state.occasion,
        occasion_custom: state.occasionCustom,
        guest_count: state.guestCount,
        delivery_type: state.deliveryType,
        delivery_address: state.deliveryAddress || null,
        delivery_zip: state.deliveryZip || null,
        delivery_fee: state.deliveryFee || 0,
        allergens: state.allergens,
        design_level: state.designLevel || null,
        items,
        deposit_amount: state._deposit,
        total_amount: state._total
      })
    });
    const bookingData = await bookingRes.json();
    if (!bookingRes.ok) throw new Error(bookingData.error || 'Kunne ikke opprette bestilling');
    state.bookingId = bookingData.booking_id;

    // Create SumUp checkout
    $('step8Pay').textContent = 'Starter betaling...';
    const payRes = await fetch('/api/payment/sumup/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: state.bookingId,
        amount: state._deposit,
        description: `Kakefrue depositum – bestilling #${state.bookingId}`
      })
    });
    const payData = await payRes.json();
    if (!payRes.ok) throw new Error(payData.error || 'Betalingsfeil');

    // Redirect to SumUp or handle dev mode
    if (payData.redirect_url || payData.hosted_checkout_url) {
      window.location.href = payData.redirect_url || payData.hosted_checkout_url;
    } else {
      // Dev mode — simulate success
      await fetch('/api/payment/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: state.bookingId, checkout_id: payData.id })
      });
      showSuccess();
    }
  } catch (err) {
    showError('step8Error', err.message);
    $('step8Pay').disabled = false;
    $('step8Pay').textContent = 'Betal depositum 💳';
  }
});

function showSuccess() {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  $('stepSuccess').classList.add('active');
  $('bookingProgress').style.display = 'none';
}

// ── Handle return from payment ─────────────────────────────
(async function checkPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment_complete') === '1') {
    const bookingId = params.get('booking_id');
    const checkoutId = params.get('checkout_id') || params.get('id');
    if (bookingId) {
      try {
        const res = await fetch('/api/payment/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: bookingId, checkout_id: checkoutId || 'redirect-confirm' })
        });
        const data = await res.json();
        if (data.success) showSuccess();
      } catch (e) {}
      // Clean URL
      history.replaceState({}, '', '/book.html');
    }
  }
})();
