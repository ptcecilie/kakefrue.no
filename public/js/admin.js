/* ============================================================
   Kakefrue — Admin Panel Logic
   ============================================================ */

let adminPassword = '';
let adminCalYear = new Date().getFullYear();
let adminCalMonth = new Date().getMonth();
let allBookings = [];
let allDates = [];

// ── Utility ───────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { 'X-Admin-Password': adminPassword, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  }).then(async r => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Feil');
    return data;
  });
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('nb-NO', { day:'numeric', month:'short', year:'numeric' });
}
function statusBadge(s) {
  const map = { pending:'tag-pending', confirmed:'tag-confirmed', cancelled:'tag-cancelled', completed:'tag-completed' };
  const labels = { pending:'Venter', confirmed:'Bekreftet', cancelled:'Avlyst', completed:'Fullført' };
  return `<span class="tag ${map[s] || 'tag-gold'}">${labels[s] || s}</span>`;
}
function showAlert(message, type = 'info') {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:8px;font-size:0.9rem;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.15);background:${type === 'error' ? '#c0392b' : '#4a7c59'};color:#fff;transition:opacity 0.4s;`;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3000);
}
function openModal(html) {
  $('modalContent').innerHTML = html;
  $('modalBackdrop').classList.remove('hidden');
}
function closeModal() { $('modalBackdrop').classList.add('hidden'); }
$('modalBackdrop').addEventListener('click', e => { if (e.target === $('modalBackdrop')) closeModal(); });

// ── Login ──────────────────────────────────────────────────
async function attemptLogin(pw) {
  adminPassword = pw;
  await api('/api/admin/stats');
  localStorage.setItem('kakefrue_admin_pw', pw);
  $('loginScreen').classList.add('hidden');
  $('adminApp').classList.remove('hidden');
  initAdmin();
}

$('loginBtn').addEventListener('click', async () => {
  const pw = $('adminPassword').value.trim();
  if (!pw) return;
  $('loginBtn').disabled = true;
  $('loginBtn').textContent = 'Logger inn...';
  try {
    await attemptLogin(pw);
  } catch {
    $('loginError').textContent = 'Feil passord. Prøv igjen.';
    $('loginError').classList.remove('hidden');
    adminPassword = '';
    localStorage.removeItem('kakefrue_admin_pw');
  } finally {
    $('loginBtn').disabled = false;
    $('loginBtn').textContent = 'Logg inn';
  }
});
$('adminPassword').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });

// Auto-login fra localStorage
(async () => {
  const saved = localStorage.getItem('kakefrue_admin_pw');
  if (saved) {
    try { await attemptLogin(saved); } catch { localStorage.removeItem('kakefrue_admin_pw'); }
  }
})();

// ── Navigation ─────────────────────────────────────────────
document.querySelectorAll('.admin-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.admin-nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    const panel = item.dataset.panel;
    $('panel-' + panel).classList.add('active');
    loadPanel(panel);
  });
});

function loadPanel(panel) {
  switch (panel) {
    case 'oversikt': loadStats(); loadRecentBookings(); break;
    case 'kalender': loadDates(); break;
    case 'bestillinger': loadBookings(); break;
    case 'ufullstendige': loadAbandoned(); break;
    case 'provesmaking': loadTastings(); break;
    case 'kurs': loadCourses(); break;
    case 'anbefalinger': loadReviews(); break;
    case 'priser': loadPricing(); break;
    case 'innstillinger': loadSettings(); break;
  }
}

function initAdmin() {
  loadStats();
  loadRecentBookings();
}

// ── Stats ──────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await api('/api/admin/stats');
    $('stat-total').textContent = s.total_bookings;
    $('stat-pending').textContent = s.pending_bookings;
    $('stat-upcoming').textContent = s.upcoming_bookings;
    $('stat-abandoned').textContent = s.abandoned_count;
    $('stat-tastings').textContent = s.pending_tastings;

    const badgeBest = $('badge-bestillinger');
    if (s.pending_bookings > 0) { badgeBest.textContent = s.pending_bookings; badgeBest.style.display = ''; } else { badgeBest.style.display = 'none'; }
    const badgeUfull = $('badge-ufullstendige');
    if (s.abandoned_count > 0) { badgeUfull.textContent = s.abandoned_count; badgeUfull.style.display = ''; } else { badgeUfull.style.display = 'none'; }
    const badgeProv = $('badge-provesmaking');
    if (s.pending_tastings > 0) { badgeProv.textContent = s.pending_tastings; badgeProv.style.display = ''; } else { badgeProv.style.display = 'none'; }
  } catch {}
}

async function loadRecentBookings() {
  try {
    const bookings = await api('/api/admin/bookings');
    const recent = bookings.slice(0, 10);
    $('recentBookings').innerHTML = recent.length ? recent.map(b => `
      <tr>
        <td>#${b.id}</td>
        <td><strong>${b.full_name}</strong><br><span style="font-size:0.8rem;opacity:0.6;">${b.phone}</span></td>
        <td>${formatDate(b.booking_date)}</td>
        <td>${b.occasion || '—'}</td>
        <td>${statusBadge(b.status)}</td>
        <td>${b.deposit_paid ? '<span style="color:var(--sage);">✓ Betalt</span>' : '<span style="opacity:0.4;">Nei</span>'}</td>
      </tr>
    `).join('') : '<tr><td colspan="6" style="text-align:center;padding:32px;opacity:0.5;">Ingen bestillinger ennå</td></tr>';
  } catch {}
}

// ── Dates/Calendar ─────────────────────────────────────────
async function loadDates() {
  try {
    allDates = await api('/api/admin/dates');
    renderAdminCalendar();
    renderDatesTable();
  } catch {}
}

function renderAdminCalendar() {
  const monthNames = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
  $('adminCalMonth').textContent = monthNames[adminCalMonth] + ' ' + adminCalYear;

  const grid = $('adminCalGrid');
  grid.innerHTML = '';

  const today = new Date(); today.setHours(0,0,0,0);
  const firstDay = new Date(adminCalYear, adminCalMonth, 1);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;
  const daysInMonth = new Date(adminCalYear, adminCalMonth + 1, 0).getDate();

  for (let i = 0; i < startDow; i++) {
    grid.insertAdjacentHTML('beforeend', '<div></div>');
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${adminCalYear}-${String(adminCalMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dateObj = new Date(adminCalYear, adminCalMonth, d);
    const isPast = dateObj < today;
    const dateData = allDates.find(ad => ad.date && ad.date.substring(0,10) === dateStr);
    const isFull = dateData && dateData.current_bookings >= dateData.max_capacity;

    let cls = 'admin-cal-day';
    if (isPast) cls += ' past';
    if (dateData) cls += isFull ? '' : ' open';

    const cell = document.createElement('div');
    cell.className = cls;
    if (dateData && isFull) cell.style.background = 'rgba(232,170,170,0.2)';
    cell.innerHTML = `<span class="day-num">${d}</span>${dateData ? `<span class="day-info">${dateData.current_bookings}/${dateData.max_capacity}</span>` : ''}`;

    if (!isPast) {
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', () => {
        if (dateData) openEditDateModal(dateData);
        else openAddDateModal(dateStr);
      });
    }
    grid.appendChild(cell);
  }
}

function renderDatesTable() {
  const tbody = $('datesTableBody');
  if (!allDates.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;opacity:0.5;">Ingen åpne datoer</td></tr>';
    return;
  }
  tbody.innerHTML = allDates.map(d => `
    <tr>
      <td><strong>${formatDate(d.date)}</strong></td>
      <td>${d.max_capacity}</td>
      <td>${d.current_bookings} / ${d.max_capacity}</td>
      <td>${d.allows_delivery ? '✓' : '—'}</td>
      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.notes || '—'}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="openEditDateModal(${JSON.stringify(d).replace(/"/g,'&quot;')})">Rediger</button>
        <button class="btn btn-outline btn-sm" style="color:#C62828;border-color:#C62828;" onclick="deleteDate(${d.id})">Slett</button>
      </td>
    </tr>
  `).join('');
}

function adminCalPrev() { adminCalMonth--; if (adminCalMonth < 0) { adminCalMonth=11; adminCalYear--; } renderAdminCalendar(); }
function adminCalNext() { adminCalMonth++; if (adminCalMonth > 11) { adminCalMonth=0; adminCalYear++; } renderAdminCalendar(); }

function openAddDateModal(prefillDate = '') {
  openModal(`
    <div class="modal-header"><h3>Legg til dato</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div id="dateModalErr" class="alert alert-error hidden"></div>
      <div class="form-group"><label class="form-label">Dato *</label><input class="form-input" type="date" id="m-date" value="${prefillDate}"></div>
      <div class="form-group"><label class="form-label">Maks kapasitet</label><input class="form-input" type="number" id="m-cap" value="2" min="1" max="10" style="max-width:120px;"></div>
      <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="m-delivery" checked> Levering tillatt</label></div>
      <div class="form-group"><label class="form-label">Notater</label><input class="form-input" type="text" id="m-notes" placeholder="Valgfritt"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Avbryt</button>
      <button class="btn btn-primary" onclick="saveDate()">Lagre dato</button>
    </div>
  `);
}

function openEditDateModal(d) {
  openModal(`
    <div class="modal-header"><h3>Rediger dato – ${formatDate(d.date)}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <input type="hidden" id="m-date-id" value="${d.id}">
      <div id="dateModalErr" class="alert alert-error hidden"></div>
      <div class="form-group"><label class="form-label">Dato</label><input class="form-input" type="date" id="m-date" value="${d.date ? d.date.substring(0,10) : ''}"></div>
      <div class="form-group"><label class="form-label">Maks kapasitet</label><input class="form-input" type="number" id="m-cap" value="${d.max_capacity}" min="1" max="10" style="max-width:120px;"></div>
      <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="m-delivery" ${d.allows_delivery ? 'checked' : ''}> Levering tillatt</label></div>
      <div class="form-group"><label class="form-label">Notater</label><input class="form-input" type="text" id="m-notes" value="${d.notes || ''}"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Avbryt</button>
      <button class="btn btn-primary" onclick="saveDate()">Oppdater</button>
    </div>
  `);
}

async function saveDate() {
  const dateVal = $('m-date').value;
  if (!dateVal) return;
  try {
    await api('/api/admin/dates', {
      method: 'POST',
      body: JSON.stringify({
        date: dateVal,
        max_capacity: parseInt($('m-cap').value) || 2,
        allows_delivery: $('m-delivery').checked,
        notes: $('m-notes').value || null
      })
    });
    closeModal();
    loadDates();
  } catch (e) {
    $('dateModalErr').textContent = e.message;
    $('dateModalErr').classList.remove('hidden');
  }
}

async function deleteDate(id) {
  if (!confirm('Slette denne datoen?')) return;
  try { await api('/api/admin/dates/' + id, { method: 'DELETE' }); loadDates(); } catch {}
}

// ── Bookings ───────────────────────────────────────────────
async function loadBookings() {
  try {
    allBookings = await api('/api/admin/bookings');
    renderBookingsTable(allBookings);
  } catch {}
}

function renderBookingsTable(bookings) {
  const tbody = $('bookingsTableBody');
  if (!bookings.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;opacity:0.5;">Ingen bestillinger</td></tr>';
    return;
  }
  tbody.innerHTML = bookings.map(b => `
    <tr>
      <td>#${b.id}</td>
      <td><strong>${b.full_name}</strong><br><span style="font-size:0.8rem;opacity:0.6;">${b.phone}</span></td>
      <td><strong>${formatDate(b.booking_date)}</strong></td>
      <td>${b.occasion || '—'}</td>
      <td>${b.design_level || '—'}</td>
      <td>${statusBadge(b.status)}</td>
      <td>${b.deposit_paid ? '<span style="color:var(--sage);font-weight:700;">✓</span>' : '<span style="opacity:0.4;">Nei</span>'}</td>
      <td style="display:flex;gap:6px;">
        <button class="btn btn-outline btn-sm" onclick="openBookingDetail(${b.id})">Detaljer</button>
        ${b.email ? `<button class="btn btn-outline btn-sm" onclick="openEmailModal('${b.email}', '${b.full_name}')">✉️</button>` : ''}
      </td>
    </tr>
  `).join('');
}

function filterBookings() {
  const q = $('bookingSearch').value.toLowerCase();
  const filtered = allBookings.filter(b =>
    b.full_name.toLowerCase().includes(q) ||
    (b.phone && b.phone.includes(q)) ||
    (b.email && b.email.toLowerCase().includes(q)) ||
    (b.occasion && b.occasion.toLowerCase().includes(q)) ||
    String(b.id).includes(q)
  );
  renderBookingsTable(filtered);
}

async function openBookingDetail(id) {
  try {
    const b = await api('/api/admin/bookings/' + id);
    openModal(`
      <div class="modal-header"><h3>Bestilling #${b.id}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
          <div><div style="font-size:0.75rem;opacity:0.5;text-transform:uppercase;margin-bottom:4px;">Kunde</div><strong>${b.full_name}</strong><br><span style="font-size:0.85rem;">${b.phone}</span>${b.email ? `<br><span style="font-size:0.85rem;">${b.email}</span>` : ''}</div>
          <div><div style="font-size:0.75rem;opacity:0.5;text-transform:uppercase;margin-bottom:4px;">Dato</div><strong>${formatDate(b.booking_date)}</strong></div>
          <div><div style="font-size:0.75rem;opacity:0.5;text-transform:uppercase;margin-bottom:4px;">Anledning</div>${b.occasion || '—'}${b.occasion_custom ? ': ' + b.occasion_custom : ''}</div>
          <div><div style="font-size:0.75rem;opacity:0.5;text-transform:uppercase;margin-bottom:4px;">Gjester</div>${b.guest_count || '—'}</div>
          <div><div style="font-size:0.75rem;opacity:0.5;text-transform:uppercase;margin-bottom:4px;">Levering</div>${b.delivery_type === 'levering' ? 'Levering: ' + (b.delivery_address || '—') : 'Henting'}</div>
          <div><div style="font-size:0.75rem;opacity:0.5;text-transform:uppercase;margin-bottom:4px;">Allergier</div>${b.allergens ? (Array.isArray(b.allergens) ? b.allergens.join(', ') : JSON.stringify(b.allergens)) : '—'}</div>
          <div><div style="font-size:0.75rem;opacity:0.5;text-transform:uppercase;margin-bottom:4px;">Design</div>${b.design_level || '—'}</div>
          <div><div style="font-size:0.75rem;opacity:0.5;text-transform:uppercase;margin-bottom:4px;">Depositum</div>${b.deposit_paid ? '✓ Betalt' : 'Ikke betalt'}${b.deposit_amount ? ' (kr ' + b.deposit_amount + ')' : ''}</div>
        </div>
        ${b.items && b.items.length ? `<div style="margin-bottom:16px;"><div style="font-size:0.75rem;opacity:0.5;text-transform:uppercase;margin-bottom:8px;">Produkter</div>${b.items.map(i => `<div style="font-size:0.85rem;padding:6px 10px;background:var(--cream);border-radius:6px;margin-bottom:4px;">${i.category}: ${typeof i.item_details === 'string' ? i.item_details : JSON.stringify(i.item_details)}</div>`).join('')}</div>` : ''}
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-select" id="m-b-status" style="max-width:200px;">
            <option value="pending" ${b.status==='pending'?'selected':''}>Venter</option>
            <option value="confirmed" ${b.status==='confirmed'?'selected':''}>Bekreftet</option>
            <option value="completed" ${b.status==='completed'?'selected':''}>Fullført</option>
            <option value="cancelled" ${b.status==='cancelled'?'selected':''}>Avlyst</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Admin-notater</label>
          <textarea class="form-textarea" id="m-b-notes" rows="3">${b.admin_notes || ''}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Lukk</button>
        <button class="btn btn-primary" onclick="updateBooking(${b.id})">Lagre</button>
      </div>
    `);
  } catch {}
}

async function updateBooking(id) {
  try {
    await api('/api/admin/bookings/' + id, {
      method: 'PUT',
      body: JSON.stringify({ status: $('m-b-status').value, admin_notes: $('m-b-notes').value })
    });
    closeModal();
    loadBookings();
  } catch (e) { alert(e.message); }
}

// ── Abandoned ──────────────────────────────────────────────
async function loadAbandoned() {
  try {
    const rows = await api('/api/admin/abandoned');
    const tbody = $('abandonedTableBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;opacity:0.5;">Ingen ufullstendige bestillinger</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><strong>${r.full_name}</strong></td>
        <td><a href="tel:${r.phone}">${r.phone}</a></td>
        <td>${r.email || '—'}</td>
        <td>Steg ${r.last_step}</td>
        <td>${formatDate(r.created_at)}</td>
        <td>${r.contacted ? '<span style="color:var(--sage);">✓ Ja</span>' : '<span style="opacity:0.4;">Nei</span>'}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          ${!r.contacted ? `<button class="btn btn-outline btn-sm" onclick="markContacted(${r.id})">Marker kontaktet</button>` : ''}
          ${r.phone ? `<button class="btn btn-primary btn-sm" onclick="openSmsModal(${r.id}, '${r.phone}', '${r.full_name}')">📱 SMS</button>` : ''}
          ${r.email ? `<button class="btn btn-outline btn-sm" onclick="openEmailModal('${r.email}', '${r.full_name}')">✉️ E-post</button>` : ''}
          <button class="btn btn-outline btn-sm" style="color:#C62828;border-color:#C62828;" onclick="deleteAbandoned(${r.id})">Slett</button>
        </td>
      </tr>
    `).join('');
  } catch {}
}

async function markContacted(id) {
  try { await api('/api/admin/abandoned/' + id, { method: 'PUT', body: JSON.stringify({ contacted: true }) }); loadAbandoned(); loadStats(); } catch {}
}

async function deleteAbandoned(id) {
  if (!confirm('Slette denne ufullstendige bestillingen?')) return;
  try { await api('/api/admin/abandoned/' + id, { method: 'DELETE' }); loadAbandoned(); loadStats(); } catch {}
}

// ── SMS Modal ──────────────────────────────────────────────
let activeSmsId = null;
let activeSmsPhone = null;

function openSmsModal(id, phone, name) {
  activeSmsId = id;
  activeSmsPhone = phone;
  const template = `Hei ${name}! 🎂 Jeg ser du startet en bestilling hos Kakefrue. Kan jeg hjelpe deg videre, eller har du spørsmål? Svar gjerne her! – Cecilie`;
  const textarea = $('smsMessageText');
  const label = $('smsRecipientLabel');
  const lenEl = $('smsMsgLen');
  label.textContent = `${name} (${phone})`;
  textarea.value = template;
  lenEl.textContent = template.length;
  textarea.oninput = () => { lenEl.textContent = textarea.value.length; };
  $('smsModal').classList.remove('hidden');
}

function closeSmsModal() {
  $('smsModal').classList.add('hidden');
  activeSmsId = null;
  activeSmsPhone = null;
}

async function sendSms() {
  const message = $('smsMessageText').value.trim();
  if (!message) return;
  const btn = $('smsSendBtn');
  btn.textContent = 'Sender...';
  btn.disabled = true;
  try {
    await api('/api/admin/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: activeSmsPhone, message })
    });
    showAlert('SMS sendt! ✓', 'success');
    await markContacted(activeSmsId);
    closeSmsModal();
  } catch (e) {
    showAlert(e.message || 'Nettverksfeil – kunne ikke sende SMS', 'error');
  } finally {
    btn.textContent = 'Send SMS';
    btn.disabled = false;
  }
}

// ── E-post Modal ───────────────────────────────────────────
let activeEmailTo = null;
let activeEmailName = null;

function openEmailModal(email, name) {
  activeEmailTo = email;
  activeEmailName = name;
  $('emailRecipientLabel').textContent = `${name} (${email})`;
  $('emailSubjectText').value = '';
  $('emailMessageText').value = '';
  $('emailModalOverlay').style.display = 'flex';
}

function closeEmailModal() {
  $('emailModalOverlay').style.display = 'none';
  activeEmailTo = null;
  activeEmailName = null;
}

async function sendEmail() {
  const subject = $('emailSubjectText').value.trim();
  const message = $('emailMessageText').value.trim();
  if (!subject || !message) { showAlert('Fyll inn emne og melding', 'error'); return; }
  const btn = $('emailSendBtn');
  btn.textContent = 'Sender...';
  btn.disabled = true;
  try {
    await api('/api/admin/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: activeEmailTo, name: activeEmailName, subject, message })
    });
    showAlert('E-post sendt! ✓', 'success');
    closeEmailModal();
  } catch (e) {
    showAlert(e.message || 'Kunne ikke sende e-post', 'error');
  } finally {
    btn.textContent = 'Send e-post';
    btn.disabled = false;
  }
}

// ── Tastings ───────────────────────────────────────────────
async function loadTastings() {
  try {
    const rows = await api('/api/admin/tastings');
    const tbody = $('tastingsTableBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;opacity:0.5;">Ingen prøvesmakinger</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><strong>${r.full_name}</strong></td>
        <td><a href="tel:${r.phone}">${r.phone}</a></td>
        <td>${r.email || '—'}</td>
        <td>${formatDate(r.preferred_date)}</td>
        <td>${r.choice_1 || '—'}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${r.paid ? '<span style="color:var(--sage);">✓</span>' : '—'}</td>
        <td><button class="btn btn-outline btn-sm" onclick="openTastingModal(${JSON.stringify(r).replace(/"/g,'&quot;')})">Rediger</button></td>
      </tr>
    `).join('');
  } catch {}
}

function openTastingModal(t) {
  openModal(`
    <div class="modal-header"><h3>Prøvesmaking – ${t.full_name}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <p><strong>Telefon:</strong> ${t.phone} | <strong>E-post:</strong> ${t.email || '—'}</p>
      <p><strong>Ønsket dato:</strong> ${formatDate(t.preferred_date)}</p>
      <p><strong>Valg 1:</strong> ${t.choice_1 || '—'} | <strong>Valg 2:</strong> ${t.choice_2 || '—'} | <strong>Valg 3:</strong> ${t.choice_3 || '—'}</p>
      <div class="form-group"><label class="form-label">Status</label>
        <select class="form-select" id="m-t-status" style="max-width:200px;">
          <option value="pending" ${t.status==='pending'?'selected':''}>Venter</option>
          <option value="confirmed" ${t.status==='confirmed'?'selected':''}>Bekreftet</option>
          <option value="completed" ${t.status==='completed'?'selected':''}>Fullført</option>
          <option value="cancelled" ${t.status==='cancelled'?'selected':''}>Avlyst</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="m-t-paid" ${t.paid?'checked':''}> Betalt (kr 400)</label></div>
      <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="m-t-deducted" ${t.deposit_deducted?'checked':''}> Trukket fra bryllupskake</label></div>
      <div class="form-group"><label class="form-label">Notater</label><textarea class="form-textarea" id="m-t-notes" rows="3">${t.notes || ''}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Lukk</button>
      <button class="btn btn-primary" onclick="updateTasting(${t.id})">Lagre</button>
    </div>
  `);
}

async function updateTasting(id) {
  try {
    await api('/api/admin/tastings/' + id, {
      method: 'PUT',
      body: JSON.stringify({
        status: $('m-t-status').value,
        paid: $('m-t-paid').checked,
        deposit_deducted: $('m-t-deducted').checked,
        notes: $('m-t-notes').value
      })
    });
    closeModal();
    loadTastings();
    loadStats();
  } catch (e) { alert(e.message); }
}

// ── Courses ────────────────────────────────────────────────
async function loadCourses() {
  try {
    const courses = await api('/api/admin/courses');
    const container = $('coursesList');
    if (!courses.length) {
      container.innerHTML = '<div style="text-align:center;padding:48px;opacity:0.5;background:var(--white);border-radius:var(--radius);">Ingen kurs ennå. Opprett et nytt kurs!</div>';
      return;
    }
    container.innerHTML = courses.map(c => `
      <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:24px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <h3 style="margin-bottom:4px;">${c.title} ${!c.active ? '<span class="tag tag-pending">Inaktiv</span>' : ''}</h3>
            <p style="font-size:0.85rem;opacity:0.65;margin:0;">${formatDate(c.date)} ${c.time_start ? '· Kl. '+c.time_start.substring(0,5) : ''} · ${c.duration_hours}t · ${c.current_participants}/${c.max_participants} deltakere${c.price ? ' · kr '+c.price : ''}</p>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-outline btn-sm" onclick="viewRegistrations(${c.id}, '${c.title.replace(/'/g,"\\'")}')">Påmeldinger (${c.current_participants})</button>
            <button class="btn btn-outline btn-sm" onclick="openCourseModal(${JSON.stringify(c).replace(/"/g,'&quot;')})">Rediger</button>
            <button class="btn btn-outline btn-sm" style="color:#C62828;border-color:#C62828;" onclick="deleteCourse(${c.id})">Slett</button>
          </div>
        </div>
        ${c.description ? `<p style="font-size:0.9rem;opacity:0.7;margin-top:12px;margin-bottom:0;">${c.description}</p>` : ''}
      </div>
    `).join('');
  } catch {}
}

function openCourseModal(c = null) {
  openModal(`
    <div class="modal-header"><h3>${c ? 'Rediger kurs' : 'Nytt kurs'}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div id="courseModalErr" class="alert alert-error hidden"></div>
      <div class="form-group"><label class="form-label">Tittel *</label><input class="form-input" id="m-c-title" type="text" value="${c ? c.title : ''}"></div>
      <div class="form-group"><label class="form-label">Beskrivelse</label><textarea class="form-textarea" id="m-c-desc" rows="3">${c ? (c.description||'') : ''}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="form-group"><label class="form-label">Dato</label><input class="form-input" id="m-c-date" type="date" value="${c && c.date ? c.date.substring(0,10) : ''}"></div>
        <div class="form-group"><label class="form-label">Starttid</label><input class="form-input" id="m-c-time" type="time" value="${c && c.time_start ? c.time_start.substring(0,5) : ''}"></div>
        <div class="form-group"><label class="form-label">Varighet (timer)</label><input class="form-input" id="m-c-dur" type="number" value="${c ? c.duration_hours : 3}" style="max-width:100px;"></div>
        <div class="form-group"><label class="form-label">Pris (kr)</label><input class="form-input" id="m-c-price" type="number" value="${c ? (c.price||'') : ''}"></div>
        <div class="form-group"><label class="form-label">Maks deltakere</label><input class="form-input" id="m-c-max" type="number" value="${c ? c.max_participants : 8}" style="max-width:100px;"></div>
      </div>
      <div class="form-group"><label class="form-label">Ta med</label><input class="form-input" id="m-c-bring" type="text" value="${c ? (c.what_to_bring||'') : ''}"></div>
      ${c ? `<div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="m-c-active" ${c.active?'checked':''}> Aktiv (synlig på nettside)</label></div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Avbryt</button>
      <button class="btn btn-primary" onclick="saveCourse(${c ? c.id : 'null'})">${c ? 'Oppdater' : 'Opprett kurs'}</button>
    </div>
  `);
}

async function saveCourse(id) {
  const title = $('m-c-title').value.trim();
  if (!title) { $('courseModalErr').textContent='Tittel er påkrevd'; $('courseModalErr').classList.remove('hidden'); return; }
  const body = {
    title, description: $('m-c-desc').value,
    date: $('m-c-date').value || null,
    time_start: $('m-c-time').value || null,
    duration_hours: parseInt($('m-c-dur').value) || 3,
    price: parseFloat($('m-c-price').value) || null,
    max_participants: parseInt($('m-c-max').value) || 8,
    what_to_bring: $('m-c-bring').value || null,
    active: $('m-c-active') ? $('m-c-active').checked : true
  };
  try {
    if (id) await api('/api/admin/courses/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/admin/courses', { method: 'POST', body: JSON.stringify(body) });
    closeModal(); loadCourses();
  } catch (e) { $('courseModalErr').textContent=e.message; $('courseModalErr').classList.remove('hidden'); }
}

async function deleteCourse(id) {
  if (!confirm('Slette dette kurset?')) return;
  try { await api('/api/admin/courses/' + id, { method: 'DELETE' }); loadCourses(); } catch {}
}

async function viewRegistrations(courseId, title) {
  try {
    const regs = await api('/api/admin/courses/' + courseId + '/registrations');
    openModal(`
      <div class="modal-header"><h3>Påmeldinger – ${title}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        ${regs.length ? `
          <table class="data-table" style="width:100%;">
            <thead><tr><th>Navn</th><th>Telefon</th><th>E-post</th><th>Betalt</th><th>Dato</th></tr></thead>
            <tbody>${regs.map(r => `<tr><td>${r.full_name}</td><td>${r.phone}</td><td>${r.email}</td><td>${r.paid?'✓':'—'}</td><td>${formatDate(r.created_at)}</td></tr>`).join('')}</tbody>
          </table>` : '<p style="text-align:center;opacity:0.5;padding:24px;">Ingen påmeldinger ennå</p>'}
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Lukk</button></div>
    `);
  } catch {}
}

// ── Reviews ────────────────────────────────────────────────
async function loadReviews() {
  try {
    const reviews = await api('/api/admin/reviews');
    const tbody = $('reviewsTableBody');
    if (!reviews.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;opacity:0.5;">Ingen anbefalinger ennå</td></tr>';
      return;
    }
    tbody.innerHTML = reviews.map(r => `
      <tr>
        <td><strong>${r.customer_name || '—'}</strong></td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.review_text || '—'}</td>
        <td>${'★'.repeat(r.rating || 5)}</td>
        <td>${r.approved ? '<span style="color:var(--sage);">✓ Ja</span>' : '<span style="color:#C62828;">Nei</span>'}</td>
        <td>${formatDate(r.created_at)}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="toggleApproved(${r.id}, ${!r.approved})">${r.approved ? 'Skjul' : 'Godkjenn'}</button>
          <button class="btn btn-outline btn-sm" style="color:#C62828;border-color:#C62828;" onclick="deleteReview(${r.id})">Slett</button>
        </td>
      </tr>
    `).join('');
  } catch {}
}

function openReviewModal() {
  openModal(`
    <div class="modal-header"><h3>Legg til anbefaling</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div id="reviewModalErr" class="alert alert-error hidden"></div>
      <div class="form-group"><label class="form-label">Kundenavn</label><input class="form-input" id="m-r-name" type="text" placeholder="F.eks. Marianne S."></div>
      <div class="form-group"><label class="form-label">Anmeldelsestekst *</label><textarea class="form-textarea" id="m-r-text" rows="4" placeholder="Anmeldelsestekst..."></textarea></div>
      <div class="form-group"><label class="form-label">Rating (1–5)</label><input class="form-input" id="m-r-rating" type="number" min="1" max="5" value="5" style="max-width:100px;"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Avbryt</button>
      <button class="btn btn-primary" onclick="saveReview()">Legg til</button>
    </div>
  `);
}

async function saveReview() {
  const text = $('m-r-text').value.trim();
  if (!text) { $('reviewModalErr').textContent='Tekst er påkrevd'; $('reviewModalErr').classList.remove('hidden'); return; }
  try {
    await api('/api/admin/reviews', {
      method: 'POST',
      body: JSON.stringify({ customer_name: $('m-r-name').value, review_text: text, rating: parseInt($('m-r-rating').value) || 5 })
    });
    closeModal(); loadReviews();
  } catch (e) { $('reviewModalErr').textContent=e.message; $('reviewModalErr').classList.remove('hidden'); }
}

async function toggleApproved(id, approved) {
  try { await api('/api/admin/reviews/' + id, { method: 'PUT', body: JSON.stringify({ approved }) }); loadReviews(); } catch {}
}
async function deleteReview(id) {
  if (!confirm('Slette denne anbefalingen?')) return;
  try { await api('/api/admin/reviews/' + id, { method: 'DELETE' }); loadReviews(); } catch {}
}

// ── Pricing ────────────────────────────────────────────────
async function loadPricing() {
  try {
    const prices = await api('/api/admin/pricing');
    const grouped = {};
    prices.forEach(p => { if (!grouped[p.category]) grouped[p.category] = []; grouped[p.category].push(p); });
    const catLabels = { design:'Design', kake:'Kake', cupcakes:'Cupcakes', allergen:'Allergentillegg', levering:'Levering', sesong:'Sesong/Jul', standard:'Standardkaker' };

    $('pricingContent').innerHTML = Object.entries(grouped).map(([cat, items]) => `
      <div class="data-table-wrap" style="margin-bottom:20px;">
        <div class="data-table-header"><h3>${catLabels[cat] || cat}</h3></div>
        <table class="data-table" style="width:100%;">
          <thead><tr><th>Navn</th><th>Pris</th><th>Beskrivelse</th><th>Handlinger</th></tr></thead>
          <tbody>
            ${items.map(p => `
              <tr>
                <td><strong>${p.label}</strong><br><span style="font-size:0.75rem;opacity:0.5;">${p.category}/${p.item_key}</span></td>
                <td><strong>kr ${p.price},-</strong></td>
                <td style="font-size:0.85rem;opacity:0.7;">${p.description || '—'}</td>
                <td><button class="btn btn-outline btn-sm" onclick="openEditPriceModal(${JSON.stringify(p).replace(/"/g,'&quot;')})">Rediger</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('');
  } catch {}
}

function openPriceModal() {
  openModal(`
    <div class="modal-header"><h3>Ny prislinje</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div id="priceModalErr" class="alert alert-error hidden"></div>
      <div class="form-group"><label class="form-label">Kategori *</label><input class="form-input" id="m-p-cat" placeholder="F.eks. design, kake, allergen"></div>
      <div class="form-group"><label class="form-label">Nøkkel *</label><input class="form-input" id="m-p-key" placeholder="F.eks. enkel, etasje_1"></div>
      <div class="form-group"><label class="form-label">Navn *</label><input class="form-input" id="m-p-label" placeholder="Visningsnavn"></div>
      <div class="form-group"><label class="form-label">Pris (kr) *</label><input class="form-input" id="m-p-price" type="number" style="max-width:150px;"></div>
      <div class="form-group"><label class="form-label">Beskrivelse</label><input class="form-input" id="m-p-desc"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Avbryt</button>
      <button class="btn btn-primary" onclick="savePriceNew()">Legg til</button>
    </div>
  `);
}

async function savePriceNew() {
  const body = { category:$('m-p-cat').value, item_key:$('m-p-key').value, label:$('m-p-label').value, price:parseFloat($('m-p-price').value), description:$('m-p-desc').value };
  if (!body.category||!body.item_key||!body.label||isNaN(body.price)) { $('priceModalErr').textContent='Fyll inn alle påkrevde felt'; $('priceModalErr').classList.remove('hidden'); return; }
  try { await api('/api/admin/pricing', { method:'POST', body:JSON.stringify(body) }); closeModal(); loadPricing(); } catch (e) { $('priceModalErr').textContent=e.message; $('priceModalErr').classList.remove('hidden'); }
}

function openEditPriceModal(p) {
  openModal(`
    <div class="modal-header"><h3>Rediger pris – ${p.label}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div id="priceModalErr" class="alert alert-error hidden"></div>
      <div class="form-group"><label class="form-label">Navn</label><input class="form-input" id="m-p-label" value="${p.label}"></div>
      <div class="form-group"><label class="form-label">Pris (kr)</label><input class="form-input" id="m-p-price" type="number" value="${p.price}" style="max-width:150px;"></div>
      <div class="form-group"><label class="form-label">Beskrivelse</label><input class="form-input" id="m-p-desc" value="${p.description||''}"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Avbryt</button>
      <button class="btn btn-primary" onclick="saveEditPrice(${p.id})">Oppdater</button>
    </div>
  `);
}

async function saveEditPrice(id) {
  try {
    await api('/api/admin/pricing/' + id, { method:'PUT', body:JSON.stringify({ label:$('m-p-label').value, price:parseFloat($('m-p-price').value), description:$('m-p-desc').value }) });
    closeModal(); loadPricing();
  } catch (e) { $('priceModalErr').textContent=e.message; $('priceModalErr').classList.remove('hidden'); }
}

// ── Settings ───────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await api('/api/admin/settings');
    if ($('set-deposit')) $('set-deposit').value = s.deposit_percentage || 30;
    if ($('set-delivery')) $('set-delivery').value = s.delivery_fee || 200;
    if ($('set-tasting')) $('set-tasting').value = s.tasting_price || 400;
  } catch {}
}

async function saveSettings() {
  const updates = {
    deposit_percentage: $('set-deposit').value,
    delivery_fee: $('set-delivery').value,
    tasting_price: $('set-tasting').value
  };
  const newPass = $('set-newpass').value;
  const newPass2 = $('set-newpass2').value;
  if (newPass) {
    if (newPass !== newPass2) { alert('Passordene stemmer ikke overens.'); return; }
    updates.admin_password = newPass;
    adminPassword = newPass;
  }
  try {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(updates) });
    $('settingsSuccess').classList.remove('hidden');
    setTimeout(() => $('settingsSuccess').classList.add('hidden'), 3000);
    $('set-newpass').value = '';
    $('set-newpass2').value = '';
  } catch (e) { alert(e.message); }
}
