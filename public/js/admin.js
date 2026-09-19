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
  // Merk denne nettleseren så Cecilies egne besøk holdes utenfor statistikken
  api('/api/admin/ikke-spor', { method: 'POST' }).catch(() => {});
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
function activatePanel(panel) {
  document.querySelectorAll('.admin-nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  const navItem = document.querySelector(`.admin-nav-item[data-panel="${panel}"]`);
  if (navItem) navItem.classList.add('active');
  const panelEl = document.getElementById('panel-' + panel);
  if (panelEl) panelEl.classList.add('active');
  loadPanel(panel);
  location.hash = panel;
}

document.querySelectorAll('.admin-nav-item').forEach(item => {
  item.addEventListener('click', () => activatePanel(item.dataset.panel));
});

// ── Stat card navigation ────────────────────────────────────
function gotoPanel(panel) { activatePanel(panel); }

function clearBadge(panel) {
  const badge = document.getElementById('badge-' + panel);
  if (badge) badge.style.display = 'none';
  localStorage.setItem('badge_cleared_' + panel, Date.now());
}

function isBadgeCleared(panel) {
  return !!localStorage.getItem('badge_cleared_' + panel);
}

function loadPanel(panel) {
  switch (panel) {
    case 'oversikt': loadStats(); loadRecentBookings(); break;
    case 'kalender': loadDates(); break;
    case 'bestillinger': loadBookings(); clearBadge('bestillinger'); break;
    case 'ufullstendige': loadAbandoned(); clearBadge('ufullstendige'); break;
    case 'provesmaking': loadTastings(); clearBadge('provesmaking'); break;
    case 'kurs': loadCourses(); loadCourseRegistrations(); loadCourseInterests(); break;
    case 'anbefalinger': loadReviews(); break;
    case 'priser': loadPricing(); break;
    case 'kunder': loadCustomers(); break;
    case 'jul': loadJulProdukter(); loadChristmasOrders(); break;
    case 'eventer': loadEventer(); break;
    case 'bilder': loadPhotos(); loadAboutImages(); break;
    case 'spesial': loadSpesial(); break;
    case 'etiketter': loadEtiketter(); break;
    case 'statistikk': loadStatistikk(); break;
    case 'naring': loadNaringskalkulator(); break;
    case 'innstillinger': loadSettings(); break;
  }
}

// ── Kunder ─────────────────────────────────────────────────
let allCustomers = [];

async function loadCustomers() {
  try {
    allCustomers = await api('/api/admin/customers');
    renderCustomers(allCustomers);
  } catch (e) { console.error(e); }
}

function renderCustomers(list) {
  const tbody = $('customersTableBody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;opacity:0.5;">Ingen kunder ennå</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(c => `
    <tr>
      <td style="opacity:0.4;">${c.id}</td>
      <td><strong>${c.full_name}</strong></td>
      <td><a href="tel:${c.phone}">${c.phone}</a></td>
      <td>${c.email ? `<a href="mailto:${c.email}">${c.email}</a>` : '<span style="opacity:0.35;">—</span>'}</td>
      <td>${formatDate(c.created_at)}</td>
      <td>${c.booking_count > 0 ? `<span style="color:var(--sage);font-weight:600;">${c.booking_count} bestilling${c.booking_count !== 1 ? 'er' : ''}</span>` : '<span style="opacity:0.35;">0</span>'}</td>
      <td style="display:flex;gap:6px;">
        ${c.email ? `<button class="btn btn-outline btn-sm" data-email="${c.email}" data-name="${c.full_name.replace(/"/g,'&quot;')}" onclick="openEmailModal(this.dataset.email,this.dataset.name)">✉️</button>` : ''}
        <button class="btn btn-outline btn-sm" style="color:#C62828;border-color:#C62828;" onclick="deleteCustomer(${c.id})">Slett</button>
      </td>
    </tr>
  `).join('');
}

function filterCustomers() {
  const q = $('customerSearch').value.toLowerCase();
  renderCustomers(allCustomers.filter(c =>
    c.full_name.toLowerCase().includes(q) ||
    c.phone.includes(q) ||
    (c.email || '').toLowerCase().includes(q)
  ));
}

function openAddCustomerModal() {
  $('newCustomerName').value = '';
  $('newCustomerPhone').value = '';
  $('newCustomerEmail').value = '';
  $('addCustomerModal').classList.remove('hidden');
}

function closeAddCustomerModal() {
  $('addCustomerModal').classList.add('hidden');
}

async function deleteCustomer(id) {
  if (!confirm('Slette denne kunden? Dette kan ikke angres.')) return;
  try {
    await api('/api/admin/customers/' + id, { method: 'DELETE' });
    showAlert('Kunde slettet', 'success');
    loadCustomers();
  } catch (e) {
    showAlert(e.message || 'Noe gikk galt', 'error');
  }
}

async function saveNewCustomer() {
  const full_name = $('newCustomerName').value.trim();
  const phone = $('newCustomerPhone').value.trim();
  const email = $('newCustomerEmail').value.trim();
  if (!full_name || !phone) { showAlert('Navn og telefon er påkrevd', 'error'); return; }
  try {
    await api('/api/admin/customers', { method: 'POST', body: JSON.stringify({ full_name, phone, email }) });
    closeAddCustomerModal();
    showAlert('Kunde lagret! ✓', 'success');
    loadCustomers();
  } catch (e) {
    showAlert(e.message || 'Noe gikk galt', 'error');
  }
}

// ── Julebestillinger ───────────────────────────────────────
async function exportJulebestillingerExcel() {
  try {
    const orders = await api('/api/admin/christmas-orders');
    if (!orders.length) { showAlert('Ingen bestillinger å eksportere', 'error'); return; }
    const rows = [['Nr','Dato','Navn','Telefon','E-post','Henting/Levering','Adresse','Produkter','Varesum (kr)','Levering (kr)','Totalt (kr)','Kommentar']];
    orders.forEach((o, i) => {
      const prods = (o.products || []).map(p => `${p.name} x${p.qty}`).join(', ');
      const varesum = (o.products || []).reduce((s, p) => s + (p.price || 0) * (p.qty || 1), 0);
      const frakt = parseInt(o.delivery_cost) || 0;
      rows.push([
        i + 1,
        o.created_at ? new Date(o.created_at).toLocaleDateString('nb-NO') : '',
        o.full_name || '',
        o.phone || '',
        o.email || '',
        o.delivery === 'levering' ? 'Levering' : 'Henting',
        o.address || '',
        prods,
        varesum || 0,
        frakt || 0,
        varesum + frakt,
        o.note || ''
      ]);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [5,12,20,13,24,15,26,42,12,13,12,26].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Bestillinger');
    XLSX.writeFile(wb, `Bestillingsliste ${new Date().getFullYear()}.xlsx`);
  } catch (e) { showAlert('Eksport feilet: ' + e.message, 'error'); }
}

const HENTEADRESSE = 'Snarvegen 8, 3925 Porsgrunn';

// Avslutningslinje for julepost-temaet (se byggHentetekst()).
const PERSONLIG_UTKAST = 'En varm juleklem sendes deg fra\nKakefrue';

function googleMapsLenke(sted) {
  return sted ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(sted) : '';
}

function aapneHentemelding(o) {
  const levering = o.delivery === 'levering';
  const varer = (o.products || []).map(p => `${p.name} x${p.qty}`).join(', ');
  const iMorgen = new Date(Date.now() + 86400000).toLocaleDateString('nb-NO', { weekday:'long', day:'numeric', month:'long' });
  const varslet = o.notified_at
    ? `<div style="background:rgba(122,158,130,.14);border:1px solid rgba(122,158,130,.4);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:0.85rem;">
         ✓ Allerede varslet ${new Date(o.notified_at).toLocaleString('nb-NO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
         ${o.notified_via ? ' på ' + o.notified_via : ''}
         <button class="btn btn-outline btn-sm" style="margin-left:10px;padding:3px 10px;" onclick="settVarslet(${o.id}, false)">Angre</button>
       </div>` : '';

  openModal(`
    <div class="modal-header">
      <h3>${levering ? '🚗 Levering' : '📦 Klar til henting'} – ${o.full_name}</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      ${varslet}
      <div style="display:grid;grid-template-columns:${levering ? '1fr 1fr 1fr' : '1fr 1fr'};gap:14px;">
        <div class="form-group">
          <label class="form-label">${levering ? 'Leveringsdag' : 'Hentedag'}</label>
          <input class="form-input" id="hentNaar" value="${iMorgen}" oninput="byggHentetekst()">
        </div>
        <div class="form-group">
          <label class="form-label">${levering ? 'Fra kl.' : 'Tidspunkt'}</label>
          <input class="form-input" id="hentTid" placeholder="${levering ? 'f.eks. 16' : 'f.eks. mellom 16 og 19'}" oninput="byggHentetekst()">
        </div>
        ${levering ? `<div class="form-group">
          <label class="form-label">Til kl. <span style="font-weight:300;opacity:.55;">(valgfritt)</span></label>
          <input class="form-input" id="hentTidTil" placeholder="f.eks. 18" oninput="byggHentetekst()">
        </div>` : ''}
      </div>
      ${levering
        ? `<div class="form-group">
             <label class="form-label">Leveringsadresse <span style="font-weight:300;opacity:.6;">(fra bestillingen)</span></label>
             <input class="form-input" id="hentSted" value="${(o.address||'').replace(/"/g,'&quot;')}" oninput="byggHentetekst()">
           </div>`
        : `<div class="form-group">
             <label class="form-label">Hentested</label>
             <input class="form-input" id="hentSted" value="${o.delivery === 'marked' ? (o.address || '').replace(/"/g, '&quot;') : HENTEADRESSE}" oninput="byggHentetekst()">
           </div>`}

      <div class="form-group">
        <label class="form-label">Holdbarhet <span style="font-weight:300;opacity:0.55;">– valgfritt, legges inn i meldingen</span></label>
        <input class="form-input" id="hentHoldbar" list="holdbarForslag" placeholder="Velg eller skriv fritt" oninput="byggHentetekst()">
        <datalist id="holdbarForslag">
          <option value="Lefsene er best de første dagene, men de fryser fint – da kan du ta opp en og en etter behov.">
          <option value="Krumkakene holder seg sprø i en tett boks, gjerne litt kjølig.">
          <option value="Kransekaken oppbevares tørt i tett boks, og kan også fryses.">
          <option value="Pepperkakene holder seg fine i en tett boks i flere uker.">
          <option value="Cookies er best de første dagene – de kan også fryses.">
          <option value="Denne inneholder krem og må stå kjølig. Spises innen to dager.">
        </datalist>
      </div>

      <div class="form-group" style="margin-bottom:6px;">
        <label class="form-label">Meldingen – rediger fritt</label>
        <textarea class="form-input" id="hentTekst" rows="13" style="line-height:1.65;"></textarea>
      </div>
      <p style="font-size:0.78rem;opacity:0.6;margin:0;">
        📞 ${o.phone} · ${varer || '—'}
      </p>
      <div id="hentStatus" style="font-size:0.85rem;margin-top:10px;"></div>
    </div>
    <div class="modal-footer" style="flex-wrap:wrap;gap:8px;">
      <button class="btn btn-outline" onclick="closeModal()">Lukk</button>
      <button class="btn btn-outline" onclick="kopierHentetekst(${o.id})">📋 Kopier til SMS</button>
      ${o.email
        ? `<button class="btn btn-primary" id="hentSendBtn" onclick="sendHentemelding(${o.id}, '${o.email}', '${(o.full_name||'').replace(/'/g,"&apos;")}')">✉️ Send e-post</button>`
        : `<span style="font-size:0.8rem;opacity:0.6;align-self:center;">Ingen e-post – bruk SMS</span>`}
    </div>
  `);
  window._hentKunde = o;
  byggHentetekst();
}

function byggHentetekst() {
  const o = window._hentKunde || {};
  const levering = o.delivery === 'levering';
  const naar = ($('hentNaar')?.value || '').trim();
  const tid  = ($('hentTid')?.value || '').trim();
  const tidTil = ($('hentTidTil')?.value || '').trim();
  const sted = ($('hentSted')?.value || '').trim();
  const fornavn = (o.full_name || '').split(' ')[0];
  const tidDel = tidTil ? `${tid}–${tidTil}` : tid;
  const naarDel = [naar, tidDel].filter(Boolean).join(' ') || '[fyll inn tidspunkt]';
  const holdbar = ($('hentHoldbar')?.value || '').trim();
  const holdbarLinje = holdbar ? `\n${holdbar}\n` : '';
  const adresse = sted || (levering ? '[adresse mangler]' : HENTEADRESSE);
  // Skjult markørlinje - server.js sin julEpostHtml() plukker ut lenken herfra,
  // gjør "Adresse:"-linjen over til en klikkbar Google Maps-lenke, og fjerner selve markørlinjen fra e-posten.
  const kartLinje = `\n📍 Åpne i Google Maps: ${googleMapsLenke(adresse)}`;

  $('hentTekst').value = levering
? `Hei ${fornavn}!

Julebestillingen din er ferdig, og jeg kommer med den ${naarDel}.

Adresse: ${adresse}
${holdbarLinje}${kartLinje}

${PERSONLIG_UTKAST}`
: `Hei ${fornavn}!

Julebestillingen din er ferdig og klar til henting.

Du kan hente den ${naarDel}.
Adresse: ${adresse}
${holdbarLinje}${kartLinje}

Bestillingen holdes av til deg ut hentedagen.

${PERSONLIG_UTKAST}`;
}

async function settVarslet(id, varslet, via) {
  try {
    const r = await api('/api/admin/christmas-orders/' + id, {
      method: 'PUT',
      body: JSON.stringify({ notified: varslet, via })
    });
    loadChristmasOrders();
    if (!varslet) closeModal();
    if (r.vipps_trukket) showAlert('Vipps-beløpet er trukket fra kunden', 'success');
    if (r.vipps_feil) alert('Varslet, men Vipps-beløpet ble ikke trukket:\n' + r.vipps_feil + '\n\nPrøv «Trekk beløpet» på bestillingen.');
  } catch (e) {
    alert('Kunne ikke lagre status: ' + e.message);
  }
}

function kopierHentetekst(id) {
  const t = $('hentTekst').value;
  const etterpaa = () => {
    $('hentStatus').innerHTML =
      '<span style="color:var(--sage);">✓ Kopiert – lim inn i meldingsappen.</span> ' +
      '<button class="btn btn-primary btn-sm" style="margin-left:8px;padding:4px 12px;" ' +
      `onclick="settVarslet(${id}, true, 'SMS'); $('hentStatus').innerHTML='<span style=&quot;color:var(--sage)&quot;>✓ Markert som varslet</span>';">` +
      'Jeg har sendt den ✓</button>';
  };
  navigator.clipboard.writeText(t).then(etterpaa, () => { $('hentTekst').select(); etterpaa(); });
}

async function sendHentemelding(id, epost, navn) {
  const btn = $('hentSendBtn');
  btn.disabled = true; btn.textContent = 'Sender...';
  try {
    const r = await api('/api/admin/send-email', {
      method: 'POST',
      body: JSON.stringify({
        to: epost, name: navn,
        subject: 'Julebestillingen din er klar',
        message: $('hentTekst').value,
        theme: 'jul'
      })
    });
    if (r.mailto_fallback) {
      $('hentStatus').innerHTML = '<span style="color:#C62828;">E-post er ikke satt opp på serveren.</span>';
      btn.disabled = false; btn.textContent = '✉️ Send e-post';
      return;
    }
    await settVarslet(id, true, 'e-post');
    $('hentStatus').innerHTML = '<span style="color:var(--sage);">✓ Sendt til ' + epost + '</span>';
    btn.textContent = '✓ Sendt';
  } catch (e) {
    $('hentStatus').innerHTML = '<span style="color:#C62828;">Feil: ' + e.message + '</span>';
    btn.disabled = false; btn.textContent = '✉️ Send e-post';
  }
}

async function bekreftBetaling(id) {
  if (!confirm('Har du sjekket Vipps og sett at pengene er kommet?\n\nKunden får bekreftelse på e-post når du trykker OK.')) return;
  try {
    const r = await api('/api/admin/christmas-orders/' + id + '/bekreft-betaling', { method: 'POST' });
    loadChristmasOrders();
    showAlert(r.sendt_til ? 'Bekreftelse sendt til ' + r.sendt_til : 'Markert som betalt (kunden har ingen e-post)', 'success');
  } catch (e) {
    alert('Kunne ikke bekrefte: ' + e.message);
  }
}

async function vippsTrekk(id, btn) {
  if (!confirm('Trekke beløpet fra kunden nå?\n\nGjør dette når bestillingen er klar til henting eller levering.')) return;
  btn.disabled = true;
  try {
    const r = await api('/api/admin/christmas-orders/' + id + '/vipps-trekk', { method: 'POST' });
    showAlert(r.trukket ? 'Beløpet er trukket' : 'Ingenting å trekke – betalingen er ikke godkjent eller allerede trukket', r.trukket ? 'success' : 'info');
    loadChristmasOrders();
  } catch (e) {
    alert('Kunne ikke trekke beløpet: ' + e.message);
    btn.disabled = false;
  }
}

async function vippsRefunder(id, belop, trukket, btn) {
  const tekst = trukket
    ? `Refundere ${belop} kr til kunden i Vipps?\n\nPengene går tilbake til kunden. Dette kan ikke angres.`
    : `Frigjøre reservasjonen på ${belop} kr?\n\nKunden blir ikke belastet. Dette kan ikke angres.`;
  if (!confirm(tekst)) return;
  btn.disabled = true;
  try {
    await api('/api/admin/christmas-orders/' + id + '/vipps-refunder', { method: 'POST' });
    showAlert(trukket ? 'Refundert i Vipps' : 'Reservasjonen er frigjort', 'success');
    loadChristmasOrders();
  } catch (e) {
    alert('Vipps sa nei: ' + e.message);
    btn.disabled = false;
  }
}

function vippsMerke(o) {
  const pille = (bg, farge, tekst) =>
    `<span style="align-self:center;background:${bg};color:${farge};border-radius:100px;padding:6px 13px;font-size:0.78rem;font-weight:700;">${tekst}</span>`;
  const belop = o.total_kr || 0;
  if (o.vipps_refunded_at) return pille('rgba(0,0,0,.06)', '#6B5040', '↩️ Refundert');
  if (o.vipps_captured_at) return pille('rgba(122,158,130,.2)', '#4A7A5A', '💰 Betalt (Vipps)') +
    `<button class="btn btn-outline btn-sm" onclick="vippsRefunder(${o.id}, ${belop}, true, this)">Refunder</button>`;
  if (o.paid_at) return pille('rgba(255,91,36,.12)', '#C2410C', '🔒 Reservert i Vipps') +
    `<button class="btn btn-primary btn-sm" style="background:#FF5B24;border-color:#FF5B24;color:#fff;" onclick="vippsTrekk(${o.id}, this)">Trekk beløpet</button>` +
    `<button class="btn btn-outline btn-sm" onclick="vippsRefunder(${o.id}, ${belop}, false, this)">Frigjør</button>`;
  if (['ABORTED', 'EXPIRED', 'TERMINATED'].includes(o.vipps_state)) return pille('rgba(196,120,138,.16)', '#9B3A52', 'Vipps avbrutt – ikke betalt');
  return pille('rgba(0,0,0,.05)', '#8A6858', 'Venter på Vipps');
}

async function slettJulebestilling(id, btn) {
  if (!confirm('Slette denne julebestillingen? Dette kan ikke angres.')) return;
  btn.disabled = true;
  try {
    await api('/api/admin/christmas-orders/' + id, { method: 'DELETE' });
    loadChristmasOrders();
  } catch (e) {
    alert('Kunne ikke slette: ' + e.message);
    btn.disabled = false;
  }
}

async function loadChristmasOrders() {
  const container = $('christmasOrdersList');
  try {
    const [alleOrders, eventer] = await Promise.all([
      api('/api/admin/christmas-orders'),
      api('/api/admin/eventer').catch(() => [])
    ]);
    _julOrders = alleOrders;
    _julEventer = eventer;
    const markeder = eventer.filter(e => alleOrders.some(o => o.event_id === e.id)).sort((a, b) => a.dato.localeCompare(b.dato));
    const orders = alleOrders.filter(o => _julFilter === 'alle' ? true
      : _julFilter === 'henting' ? o.delivery === 'henting'
      : _julFilter === 'levering' ? o.delivery === 'levering'
      : o.event_id === _julFilter);
    if (!alleOrders.length) {
      container.innerHTML = '<div style="text-align:center;padding:48px;opacity:0.4;">Ingen julebestillinger ennå</div>';
      return;
    }
    container.innerHTML = julFilterRad(alleOrders, markeder) +
      (orders.length ? '' : '<div style="text-align:center;padding:32px;opacity:0.45;">Ingen bestillinger her</div>') + `
      ${(() => {
        const varslet = orders.filter(x => x.notified_at).length;
        const igjen = orders.length - varslet;
        const lev = orders.filter(x => x.delivery === 'levering' && !x.notified_at).length;
        return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
          <span style="background:var(--white);border-radius:100px;padding:7px 16px;font-size:0.85rem;box-shadow:var(--shadow);">
            <strong>${orders.length}</strong> bestillinger
          </span>
          <span style="background:rgba(122,158,130,.16);border-radius:100px;padding:7px 16px;font-size:0.85rem;">
            ✓ <strong>${varslet}</strong> varslet
          </span>
          ${igjen ? `<span style="background:rgba(196,120,138,.16);border-radius:100px;padding:7px 16px;font-size:0.85rem;">
            <strong>${igjen}</strong> gjenstår</span>` : ''}
          ${lev ? `<span style="background:rgba(196,149,106,.2);border-radius:100px;padding:7px 16px;font-size:0.85rem;">
            🚗 <strong>${lev}</strong> skal leveres</span>` : ''}
          ${(() => { const v = orders.filter(x => x.payment_claimed_at && !x.paid_at).length;
            return v ? `<span style="background:rgba(139,26,26,.14);border-radius:100px;padding:7px 16px;font-size:0.85rem;">
              💰 <strong>${v}</strong> venter på betalingssjekk</span>` : ''; })()}
        </div>`;
      })()}
      ${orders.map(o => `
        <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:24px;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
            <div>
              <strong style="font-size:1.05rem;">${o.full_name}</strong>
              <span style="margin-left:12px;font-size:0.85rem;opacity:0.55;">${formatDate(o.created_at)}</span>
              ${o.notified_at
                ? `<span style="margin-left:10px;background:rgba(122,158,130,.18);color:#4A7A5A;border-radius:100px;padding:3px 11px;font-size:0.75rem;font-weight:700;">✓ Varslet ${new Date(o.notified_at).toLocaleDateString('nb-NO',{day:'numeric',month:'short'})}</span>`
                : `<span style="margin-left:10px;background:rgba(196,120,138,.16);color:#9B3A52;border-radius:100px;padding:3px 11px;font-size:0.75rem;font-weight:700;">Ikke varslet</span>`}
            </div>
            <div style="display:flex;gap:8px;">
              <a href="tel:${o.phone}" class="btn btn-outline btn-sm">📞 ${o.phone}</a>
              ${o.email ? `<button class="btn btn-outline btn-sm" data-email="${o.email}" data-name="${o.full_name.replace(/"/g,'&quot;')}" onclick="openEmailModal(this.dataset.email,this.dataset.name)">✉️</button>` : ''}
              ${o.vipps_reference ? vippsMerke(o) : o.paid_at
                ? `<span style="align-self:center;background:rgba(122,158,130,.2);color:#4A7A5A;border-radius:100px;padding:6px 13px;font-size:0.78rem;font-weight:700;">💰 Betalt</span>`
                : o.payment_claimed_at
                  ? `<button class="btn btn-primary btn-sm" style="background:#7A9E82;color:#fff;border-color:#7A9E82;" onclick="bekreftBetaling(${o.id})">💰 Bekreft betaling</button>`
                  : `<span style="align-self:center;font-size:0.78rem;opacity:0.5;">Ikke betalt</span>`}
              ${o.notified_at
                ? `<button class="btn btn-sm" style="background:#7A9E82;color:#fff;border-color:#7A9E82;" title="Allerede sendt – trykk for å se eller angre" onclick='aapneHentemelding(${JSON.stringify(o).replace(/'/g, "&apos;")})'>✓ ${o.delivery === 'levering' ? 'Levering varslet' : 'Henting varslet'} ${new Date(o.notified_at).toLocaleDateString('nb-NO',{day:'numeric',month:'short'})}</button>`
                : `<button class="btn btn-primary btn-sm" onclick='aapneHentemelding(${JSON.stringify(o).replace(/'/g, "&apos;")})'>${o.delivery === 'levering' ? '🚗 Varsle om levering' : '📦 Klar til henting'}</button>`}
              <button class="photo-delete-btn" style="padding:7px 12px;" title="Slett bestilling" onclick="slettJulebestilling(${o.id}, this)">🗑</button>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
            ${(o.products || []).map(p => `<span class="tag tag-sage">${p.name} × ${p.qty}${p.price ? ' · ' + (p.price * p.qty) + ' kr' : ''}</span>`).join('')}
          </div>
          <div style="font-size:0.85rem;opacity:0.6;display:flex;gap:16px;flex-wrap:wrap;">
            <span>${o.delivery === 'levering' ? `🚗 Levering: ${o.address || '—'}` : o.delivery === 'marked' ? `🎪 Hentes på: ${o.address || '—'}` : '🏠 Henting'}</span>
            ${(() => {
              const vare = (o.products||[]).reduce((s,p)=>s+(p.price||0)*(p.qty||1),0);
              const frakt = parseInt(o.delivery_cost) || 0;
              if (!vare) return '';
              return `<span>💰 Varer: ${vare} kr${frakt ? ` + frakt ${frakt} kr` : ''} · Totalt: <strong>${vare + frakt} kr</strong></span>`;
            })()}
            ${o.note ? `<span>💬 <em>${o.note}</em></span>` : ''}
          </div>
        </div>
      `).join('')}
    `;
  } catch (e) {
    console.error('Julebestillinger:', e);
    container.innerHTML = `<div style="padding:32px;opacity:0.7;">Kunne ikke laste bestillinger.<br><small style="opacity:0.7;">Feil: ${escA(e.message)}</small></div>`;
  }
}

// ── Julebestillinger per marked: filter og utskrift ────────
let _julFilter = 'alle', _julOrders = [], _julEventer = [];
const escA = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eventDato = e => new Date(e.dato + 'T12:00:00').toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const erBetalt = o => !!(o.paid_at || o.vipps_captured_at);

function settJulFilter(f) { _julFilter = f; loadChristmasOrders(); }

function julFilterRad(alle, markeder) {
  const chip = (f, tekst, antall) =>
    `<button class="btn btn-sm ${_julFilter === f ? 'btn-primary' : 'btn-outline'}" onclick='settJulFilter(${JSON.stringify(f)})'>${tekst} <span style="opacity:0.6;">${antall}</span></button>`;
  const valgt = markeder.find(e => e.id === _julFilter);
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      ${chip('alle', 'Alle', alle.length)}
      ${chip('henting', '🏠 Henting', alle.filter(o => o.delivery === 'henting').length)}
      ${chip('levering', '🚗 Levering', alle.filter(o => o.delivery === 'levering').length)}
      ${markeder.map(e => chip(e.id, '🎪 ' + escA(e.sted || e.tittel), alle.filter(o => o.event_id === e.id).length)).join('')}
    </div>
    ${valgt ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:18px;padding:12px 14px;background:rgba(196,149,106,.12);border-radius:10px;">
      <span style="font-size:0.88rem;flex:1;min-width:200px;"><strong>${escA(valgt.tittel)}</strong> · ${eventDato(valgt)}</span>
      <button class="btn btn-outline btn-sm" onclick="skrivUtMarkedListe(${valgt.id})">🖨 Skriv ut liste</button>
      <button class="btn btn-outline btn-sm" onclick="skrivUtNavnelapper(${valgt.id})">🏷 Skriv ut navnelapper</button>
    </div>` : ''}`;
}

function markedBestillinger(id) {
  return _julOrders.filter(o => o.event_id === id && !o.vipps_refunded_at)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'nb'));
}

function skrivUt(tittel, innhold, css) {
  const w = window.open('', '_blank');
  if (!w) { alert('Nettleseren stoppet utskriftsvinduet. Tillat popup-vinduer for kakefrue.no og prøv igjen.'); return; }
  w.document.write(`<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>${escA(tittel)}</title><style>
    body{font-family:Helvetica,Arial,sans-serif;color:#222;margin:24px;}
    h1{font-size:20px;margin:0 0 4px;} .under{color:#666;font-size:13px;margin:0 0 18px;}
    ${css}</style></head><body>${innhold}<script>window.onload=function(){window.print();};<\/script></body></html>`);
  w.document.close();
}

function skrivUtMarkedListe(id) {
  const e = _julEventer.find(x => x.id === id);
  const liste = markedBestillinger(id);
  const sum = {};
  liste.forEach(o => (o.products || []).forEach(p => { sum[p.name] = (sum[p.name] || 0) + p.qty; }));
  skrivUt('Hentinger – ' + e.tittel, `
    <h1>Hentinger: ${escA(e.tittel)}</h1>
    <p class="under">${eventDato(e)}${e.fra ? ` kl. ${e.fra}–${e.til || ''}` : ''} · ${liste.length} bestillinger</p>
    <table><thead><tr><th class="k">✓</th><th>Navn</th><th>Telefon</th><th>Varer</th><th>Betalt</th></tr></thead><tbody>
    ${liste.map(o => `<tr><td class="k"><span class="boks"></span></td><td><strong>${escA(o.full_name)}</strong></td><td>${escA(o.phone)}</td>
      <td>${(o.products || []).map(p => `${escA(p.name)} × ${p.qty}`).join('<br>')}</td>
      <td>${erBetalt(o) ? 'Ja' : '<strong>NEI</strong>'}</td></tr>`).join('')}
    </tbody></table>
    <h2>Totalt å pakke</h2>
    <ul>${Object.entries(sum).map(([n, q]) => `<li>${escA(n)}: <strong>${q}</strong></li>`).join('')}</ul>`,
    `table{width:100%;border-collapse:collapse;font-size:13px;}
     th,td{border-bottom:1px solid #ccc;padding:8px 6px;text-align:left;vertical-align:top;}
     th{font-size:11px;text-transform:uppercase;color:#666;} .k{width:28px;}
     .boks{display:inline-block;width:16px;height:16px;border:1.5px solid #333;border-radius:3px;}
     h2{font-size:15px;margin:22px 0 6px;} ul{margin:0;padding-left:18px;font-size:13px;} tr{page-break-inside:avoid;}`);
}

function skrivUtNavnelapper(id) {
  const e = _julEventer.find(x => x.id === id);
  const dag = new Date(e.dato + 'T12:00:00').toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
  skrivUt('Navnelapper – ' + e.tittel, `<div class="ark">${markedBestillinger(id).map(o => `
    <div class="lapp">
      <div class="merke">KAKEFRUE</div>
      <div class="navn">${escA(o.full_name)}</div>
      <div class="tlf">${escA(o.phone)}</div>
      <div class="varer">${(o.products || []).map(p => `${escA(p.name)} × ${p.qty}`).join('<br>')}</div>
      <div class="sted">${escA(e.sted || e.tittel)} · ${dag}${erBetalt(o) ? '' : ' · <strong>IKKE BETALT</strong>'}</div>
    </div>`).join('')}</div>`,
    `body{margin:10mm;} .ark{display:grid;grid-template-columns:1fr 1fr;gap:6mm;}
     .lapp{border:1.5px dashed #999;border-radius:6px;padding:5mm 6mm;page-break-inside:avoid;}
     .merke{font-size:10px;letter-spacing:.18em;color:#7A2A3E;font-weight:700;}
     .navn{font-size:22px;font-weight:700;margin:3px 0 1px;} .tlf{font-size:13px;color:#555;}
     .varer{font-size:13px;margin-top:8px;line-height:1.5;} .sted{font-size:11px;color:#777;margin-top:8px;}`);
}

// ── Eventer (forsiden «Kommende eventer» og henting på marked) ──
let _eventer = [];

function tilLokalTid(iso) {
  if (!iso) return '';
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Tirsdag kl. 23:59 før eventet
function standardFrist(dato) {
  const d = new Date(dato + 'T12:00:00');
  d.setDate(d.getDate() - (((d.getDay() - 2 + 7) % 7) || 7));
  d.setHours(23, 59, 0, 0);
  return d;
}

async function loadEventer() {
  const c = $('eventerListe');
  try {
    _eventer = await api('/api/admin/eventer');
    if (!_eventer.length) { c.innerHTML = '<div style="text-align:center;padding:48px;opacity:0.4;">Ingen eventer ennå</div>'; return; }
    const idag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
    const kommende = _eventer.filter(e => e.dato >= idag).reverse();
    const tidligere = _eventer.filter(e => e.dato < idag);
    const kort = e => `<div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px 22px;margin-bottom:12px;${e.dato < idag ? 'opacity:0.55;' : ''}">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">
        <div>
          <strong style="font-size:1.05rem;">${escA(e.tittel)}</strong>
          <div style="font-size:0.88rem;margin-top:4px;">${eventDato(e)}${e.fra ? ` · kl. ${e.fra}–${e.til || ''}` : ''}</div>
          <div style="font-size:0.85rem;opacity:0.65;">${escA([e.sted, e.adresse].filter(Boolean).join(', '))}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
            ${e.vis_forside ? '<span class="tag tag-sage">Vises på forsiden</span>' : '<span class="tag">Skjult fra forsiden</span>'}
            ${e.henting ? `<span class="tag tag-gold">Henting av bestillinger${e.frist ? ' · frist ' + new Date(e.frist).toLocaleString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' }) : ''}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-outline btn-sm" onclick="eventSkjema(${e.id})">Rediger</button>
          <button class="photo-delete-btn" style="padding:7px 12px;" title="Slett event" onclick="slettEvent(${e.id}, this)">🗑</button>
        </div>
      </div>
    </div>`;
    c.innerHTML = (kommende.length ? kommende.map(kort).join('') : '<p style="opacity:0.5;">Ingen kommende eventer.</p>') +
      (tidligere.length ? `<h3 style="font-size:1rem;margin:28px 0 12px;opacity:0.6;">Tidligere</h3>${tidligere.map(kort).join('')}` : '');
  } catch (e) {
    c.innerHTML = '<div style="padding:32px;opacity:0.5;">Kunne ikke laste eventer</div>';
  }
}

function eventSkjema(id) {
  const e = _eventer.find(x => x.id === id) || { vis_forside: true, henting: false };
  openModal(`
    <div class="modal-header">
      <h3>${id ? 'Rediger event' : 'Nytt event'}</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label" for="evTittel">Navn *</label>
        <input class="form-input" id="evTittel" value="${escA(e.tittel || '')}" placeholder="Julemarked på Brekka Gård"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;">
        <div class="form-group"><label class="form-label" for="evDato">Dato *</label><input class="form-input" type="date" id="evDato" value="${e.dato || ''}"></div>
        <div class="form-group"><label class="form-label" for="evFra">Fra kl.</label><input class="form-input" type="time" id="evFra" value="${e.fra || ''}"></div>
        <div class="form-group"><label class="form-label" for="evTil">Til kl.</label><input class="form-input" type="time" id="evTil" value="${e.til || ''}"></div>
      </div>
      <div class="form-group"><label class="form-label" for="evSted">Sted</label>
        <input class="form-input" id="evSted" value="${escA(e.sted || '')}" placeholder="Brekka Gård"></div>
      <div class="form-group"><label class="form-label" for="evAdresse">Adresse (brukes til kartlenken)</label>
        <input class="form-input" id="evAdresse" value="${escA(e.adresse || '')}" placeholder="Elsetvegen 4, 3731 Skien"></div>
      <div class="form-group"><label class="form-label" for="evTekst">Kort tekst</label>
        <textarea class="form-input" id="evTekst" rows="3">${escA(e.beskrivelse || '')}</textarea></div>
      <label style="display:flex;gap:10px;align-items:center;margin:6px 0;cursor:pointer;">
        <input type="checkbox" id="evForside" ${e.vis_forside ? 'checked' : ''}> Vis på forsiden under «Kommende eventer»</label>
      <label style="display:flex;gap:10px;align-items:center;margin:6px 0;cursor:pointer;">
        <input type="checkbox" id="evHenting" ${e.henting ? 'checked' : ''} onchange="$('evFristRad').style.display=this.checked?'block':'none'"> Kunder kan bestille julebakst og hente her</label>
      <div class="form-group" id="evFristRad" style="display:${e.henting ? 'block' : 'none'};margin-top:10px;">
        <label class="form-label" for="evFrist">Bestillingsfrist for henting</label>
        <input class="form-input" type="datetime-local" id="evFrist" value="${tilLokalTid(e.frist)}">
        <p style="font-size:0.78rem;opacity:0.6;margin:6px 0 0;">Står den tom, blir fristen tirsdag kl. 23.59 før eventet.</p>
      </div>
      <div id="evFeil" style="color:#C62828;font-size:0.85rem;margin-top:8px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
        <button class="btn btn-outline" onclick="closeModal()">Avbryt</button>
        <button class="btn btn-primary" id="evLagre" onclick="lagreEvent(${id || 0})">Lagre</button>
      </div>
    </div>`);
}

async function lagreEvent(id) {
  const dato = $('evDato').value;
  const henting = $('evHenting').checked;
  const frist = henting && dato
    ? ($('evFrist').value ? new Date($('evFrist').value) : standardFrist(dato)).toISOString()
    : null;
  const data = {
    tittel: $('evTittel').value, dato, fra: $('evFra').value, til: $('evTil').value,
    sted: $('evSted').value, adresse: $('evAdresse').value, beskrivelse: $('evTekst').value,
    vis_forside: $('evForside').checked, henting, frist
  };
  $('evLagre').disabled = true;
  try {
    await api('/api/admin/eventer' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    closeModal();
    showAlert('Eventet er lagret', 'success');
    loadEventer();
  } catch (e) {
    $('evFeil').textContent = e.message;
    $('evLagre').disabled = false;
  }
}

async function slettEvent(id, btn) {
  if (!confirm('Slette dette eventet?')) return;
  btn.disabled = true;
  try {
    await api('/api/admin/eventer/' + id, { method: 'DELETE' });
    loadEventer();
  } catch (e) {
    alert(e.message);
    btn.disabled = false;
  }
}

// ── About image ────────────────────────────────────────────
async function uploadAboutImage(input, slot = 0) {
  const file = input.files[0];
  if (!file) return;
  const s = slot || 0;
  const btn = document.getElementById('aboutImageBtn' + s);
  const forh = document.getElementById('aboutImagePreview' + s);
  const plass = document.getElementById('aboutImagePlaceholder' + s);
  const gml = btn ? btn.textContent : '';
  if (btn) btn.textContent = 'Laster opp...';
  try {
    const { data, mimeType } = await compressImage(file, 1400, 0.84);
    const result = await api('/api/admin/about-image', {
      method: 'POST',
      body: JSON.stringify({ data, mimeType, slot: s })
    });
    if (forh)  { forh.src = result.url; forh.style.display = 'block'; }
    if (plass) plass.style.display = 'none';
    showAlert('Bilde lastet opp! ✓', 'success');
  } catch (e) {
    showAlert('Opplasting feilet: ' + e.message, 'error');
  } finally {
    if (btn) btn.textContent = gml || '📷 Last opp bilde';
    input.value = '';
  }
}

// Henter begge bildene naar bildepanelet aapnes
async function loadAboutImages() {
  for (const s of [0, 1]) {
    try {
      const d = await fetch('/api/about-image?slot=' + s).then(r => r.json());
      const forh = document.getElementById('aboutImagePreview' + s);
      const plass = document.getElementById('aboutImagePlaceholder' + s);
      if (d.url && forh) {
        forh.src = d.url; forh.style.display = 'block';
        if (plass) plass.style.display = 'none';
      }
    } catch {}
  }
}



// ── Bilder ─────────────────────────────────────────────────
let _fotoCache = [];

async function loadPhotos() {
  try {
    const photos = await api('/api/admin/photos');
    _fotoCache = photos;
    const grid = document.getElementById('photoGrid');
    const counter = document.getElementById('photoCounter');
    if (counter) {
      const visible = photos.filter(p => p.featured).length;
      counter.textContent = `${photos.length} bilder totalt · ${visible} synlige på nettsiden`;
    }
    if (!photos.length) {
      grid.innerHTML = '<div style="text-align:center; padding:48px; opacity:0.4;">Ingen bilder ennå – last opp ditt første bilde!</div>';
      return;
    }
    const CATS = [
      { key: 'galleri', label: 'Galleri / Portefølje', color: '#C4956A', kort: 'galleriet',
        hjelp: 'Vises i det rullende galleriet på forsiden. Rekkefølgen her er den kunden ser – bruk pilene til høyre.' },
      { key: 'jul', label: 'Julebestillinger', color: '#7A9E82', kort: 'julesiden',
        hjelp: 'Vises i bildestripen på julesiden. Husk å sette bildene til «Synlig».' },
    ];

    // rad: nr, miniatyr, kategori + tekst, synlig/slett, opp/ned
    const radHtml = (p, i, antall) => `
      <div class="photo-card ${p.featured ? 'featured' : ''}" id="photo-${p.id}">
        <div class="photo-nr">${i + 1}</div>
        <img src="${p.url || ''}" alt="${p.alt_text || ''}" loading="lazy">
        <div class="photo-felt">
          <div style="display:flex; gap:8px; margin-bottom:7px;">
            <select class="form-input" style="font-size:0.78rem; padding:5px 8px; max-width:190px; cursor:pointer;"
                    onchange="updatePhotoCategory(${p.id}, this.value)">
              ${CATS.map(c => `<option value="${c.key}" ${p.category === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}
            </select>
            <button class="photo-featured-btn ${p.featured ? 'active' : ''}" style="flex:0 0 auto; padding:5px 14px;"
                    onclick="toggleFeatured(${p.id}, ${p.featured ? 'false' : 'true'})">
              ${p.featured ? '✓ Synlig' : '○ Skjult'}
            </button>
            <button class="photo-delete-btn" style="padding:5px 11px;" onclick="deletePhoto(${p.id})">🗑</button>
          </div>
          <input class="form-input" style="font-size:0.8rem; padding:6px 10px;"
                 value="${(p.alt_text || '').replace(/"/g, '&quot;')}"
                 placeholder="Bildetekst (valgfritt)" oninput="updatePhotoAlt(${p.id}, this.value)">
        </div>
        <div class="photo-sorter">
          <button class="photo-pil" onclick="flyttFoto(${p.id}, -1)" ${i === 0 ? 'disabled' : ''} title="Flytt opp">▲</button>
          <button class="photo-pil" onclick="flyttFoto(${p.id}, 1)" ${i === antall - 1 ? 'disabled' : ''} title="Flytt ned">▼</button>
        </div>
      </div>`;

    const seksjon = (cat, items) => `
      <div style="margin-top:26px; margin-bottom:2px;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${cat.color};"></span>
          <strong style="font-size:0.95rem;">${cat.label}</strong>
          <span style="font-size:0.8rem; opacity:0.5;">${items.filter(p => p.featured).length} synlige · ${items.length} totalt</span>
          <label class="btn btn-primary btn-sm" style="cursor:pointer; margin-left:auto;">
            + Last opp til ${cat.kort}
            <input type="file" accept="image/*" multiple style="display:none;"
                   onchange="uploadPhotos(this, '${cat.key}')">
          </label>
        </div>
        <hr style="border:none; border-top:1.5px solid ${cat.color}44; margin:10px 0 0;">
        <p style="font-size:0.78rem; opacity:0.5; margin:8px 0 0;">${cat.hjelp}</p>
      </div>
      ${items.length
        ? items.map((p, i) => radHtml(p, i, items.length)).join('')
        : '<div style="padding:12px 0; opacity:0.4; font-size:0.85rem;">Ingen bilder i denne seksjonen</div>'}`;

    grid.innerHTML = CATS.map(cat =>
      seksjon(cat, photos.filter(p => (p.category || 'galleri') === cat.key))
    ).join('');
  } catch (e) {
    const grid = document.getElementById('photoGrid');
    if (grid) grid.innerHTML = `<div style="padding:24px; color:red; font-size:0.9rem;">Feil ved lasting av bilder: ${e.message}</div>`;
  }
}

// Flytter ett bilde opp/ned – kun innenfor sin egen kategori
async function flyttFoto(id, retning) {
  const meg = _fotoCache.find(p => p.id === id);
  if (!meg) return;
  const kat = meg.category || 'galleri';
  const iKat = _fotoCache.filter(p => (p.category || 'galleri') === kat);
  const fra = iKat.findIndex(p => p.id === id);
  const til = fra + retning;
  if (fra === -1 || til < 0 || til >= iKat.length) return;

  iKat.splice(til, 0, iKat.splice(fra, 1)[0]);

  document.querySelectorAll('.photo-pil').forEach(b => b.disabled = true);
  try {
    await Promise.all(iKat.map((p, i) =>
      api('/api/admin/photos/' + p.id, { method: 'PUT', body: JSON.stringify({ sort_order: i }) })
    ));
  } catch (e) {
    alert('Kunne ikke lagre ny rekkefølge: ' + e.message);
  }
  loadPhotos();
}

function compressImage(file, maxPx = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width > height) { height = Math.round(height * maxPx / width); width = maxPx; }
          else { width = Math.round(width * maxPx / height); height = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ data: dataUrl.split(',')[1], mimeType: 'image/jpeg', name: file.name });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhotos(input, kategori = 'galleri') {
  const files = Array.from(input.files);
  if (!files.length) return;

  const progress = document.getElementById('uploadProgress');
  const bar = document.getElementById('uploadProgressBar');
  const text = document.getElementById('uploadProgressText');
  progress.style.display = 'block';
  bar.style.width = '5%';
  text.textContent = `Komprimerer ${files.length} bilde${files.length !== 1 ? 'r' : ''}...`;

  let prepared;
  try {
    prepared = await Promise.all(files.map(f => compressImage(f)));
  } catch (e) {
    text.textContent = 'Feil ved lesing av filer: ' + e.message;
    return;
  }

  bar.style.width = '20%';

  let done = 0, failed = 0, lastError = '';
  for (let i = 0; i < prepared.length; i += 2) {
    const batch = prepared.slice(i, i + 2);
    await Promise.all(batch.map(async f => {
      try {
        await api('/api/admin/photos', {
          method: 'POST',
          body: JSON.stringify({ data: f.data, mimeType: f.mimeType, alt_text: '', category: kategori })
        });
        done++;
      } catch (e) {
        failed++;
        lastError = e.message;
        console.error('Upload failed:', f.name, e);
        alert('Feil ved opplasting: ' + e.message);
      }
    }));
    bar.style.width = Math.round(20 + ((done + failed) / prepared.length) * 80) + '%';
    text.textContent = `Lastet opp ${done} av ${prepared.length}...`;
  }

  bar.style.width = '100%';
  if (failed > 0) {
    text.textContent = `${done} lastet opp, ${failed} feilet. Feil: ${lastError}`;
  } else {
    text.textContent = `${done} bilde${done !== 1 ? 'r' : ''} lastet opp! ✓`;
  }
  setTimeout(() => { progress.style.display = 'none'; }, 3000);
  input.value = '';
  loadPhotos();
}

async function toggleFeatured(id, featured) {
  try {
    await api('/api/admin/photos/' + id, { method: 'PUT', body: JSON.stringify({ featured }) });
    loadPhotos();
  } catch (e) { console.error(e); }
}

let altUpdateTimers = {};
function updatePhotoAlt(id, value) {
  clearTimeout(altUpdateTimers[id]);
  altUpdateTimers[id] = setTimeout(() => {
    api('/api/admin/photos/' + id, { method: 'PUT', body: JSON.stringify({ alt_text: value }) });
  }, 800);
}

async function updatePhotoCategory(id, category) {
  try {
    await api('/api/admin/photos/' + id, { method: 'PUT', body: JSON.stringify({ category }) });
    loadPhotos();
  } catch (e) { console.error(e); }
}

async function deletePhoto(id) {
  if (!confirm('Slette dette bildet?')) return;
  try {
    await api('/api/admin/photos/' + id, { method: 'DELETE' });
    const el = document.getElementById('photo-' + id);
    if (el) el.remove();
    const grid = document.getElementById('photoGrid');
    if (!grid.children.length) {
      grid.innerHTML = '<div style="text-align:center; padding:48px; opacity:0.4; grid-column:1/-1;">Ingen bilder ennå – last opp ditt første bilde!</div>';
    }
  } catch (e) { console.error(e); }
}

// ── Statistikk ─────────────────────────────────────────────
async function loadStatistikk() {
  // Ta vare pa valgt dato fra forrige gang, siden loadPageViews() bygger
  // #dagVelger pa nytt hver gang (uten verdi) - ellers hopper valgt dag
  // tilbake til i dag hver gang man trykker "Oppdater".
  const forrigeDato = document.getElementById('dagVelger')?.value;
  await loadPageViews();
  if (forrigeDato) document.getElementById('dagVelger').value = forrigeDato;

  try {
    const [stats, bookings] = await Promise.all([
      api('/api/admin/stats'),
      api('/api/admin/bookings')
    ]);

    // Nøkkeltall
    const confirmed = bookings.filter(b => b.status === 'confirmed' || b.status === 'completed');
    const totalRevenue = confirmed.reduce((s, b) => s + (b.total_amount || 0), 0);
    const avgOrder = confirmed.length ? Math.round(totalRevenue / confirmed.length) : 0;
    document.getElementById('statstkGrid').innerHTML = `
      <div class="stat-card"><div class="stat-value">${stats.total_bookings}</div><div class="stat-label">Totale bestillinger</div></div>
      <div class="stat-card"><div class="stat-value">kr ${totalRevenue.toLocaleString('nb-NO')}</div><div class="stat-label">Estimert omsetning</div></div>
      <div class="stat-card"><div class="stat-value">kr ${avgOrder.toLocaleString('nb-NO')}</div><div class="stat-label">Snitt per bestilling</div></div>
      <div class="stat-card"><div class="stat-value">${stats.completed_bookings || 0}</div><div class="stat-label">Fullførte</div></div>
    `;

    // Bestillinger per måned (siste 12 mnd)
    const monthlyCounts = {};
    const monthlyRevenue = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      monthlyCounts[key] = 0;
      monthlyRevenue[key] = 0;
    }
    bookings.forEach(b => {
      if (!b.booking_date) return;
      const key = b.booking_date.slice(0, 7);
      if (key in monthlyCounts) {
        monthlyCounts[key]++;
        monthlyRevenue[key] += (b.total_amount || 0);
      }
    });

    renderBarChart('chartMonthly', monthlyCounts, v => v, '#8B72BE');
    renderBarChart('chartRevenue', monthlyRevenue, v => `kr ${Math.round(v/1000)}k`, '#7A9E82');

    // Anledning
    const occasions = {};
    bookings.forEach(b => { const o = b.occasion || 'Annet'; occasions[o] = (occasions[o] || 0) + 1; });
    renderPillList('chartOccasion', occasions, stats.total_bookings);

    // Designnivå
    const designs = {};
    bookings.forEach(b => { const d = b.design_level || 'ukjent'; designs[d] = (designs[d] || 0) + 1; });
    renderPillList('chartDesign', designs, stats.total_bookings);

  } catch (e) { console.error(e); }
}

async function loadPageViews() {
  try {
    const pv = await api('/api/admin/pageviews');
    const el = document.getElementById('pageViewsSection');
    if (!el) return;

    // Fill last 30 days (including days with 0)
    const dailyMap = {};
    pv.daily.forEach(d => { dailyMap[d.view_date.slice(0,10)] = parseInt(d.count); });
    const days = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0,10);
      days[key] = dailyMap[key] || 0;
    }

    const trend = pv.last_month > 0
      ? (pv.this_month >= pv.last_month ? '↑' : '↓')
      : '';
    const trendColor = pv.this_month >= pv.last_month ? 'var(--sage)' : '#C62828';

    el.innerHTML = `
      <div class="stats-grid" style="margin-bottom:24px;">
        <div class="stat-card"><div class="stat-value">${parseInt(pv.total).toLocaleString('nb-NO')}</div><div class="stat-label">Totale sidevisninger</div></div>
        <div class="stat-card"><div class="stat-value">${parseInt(pv.this_month).toLocaleString('nb-NO')}</div><div class="stat-label">Denne måneden ${trend ? `<span style="color:${trendColor}">${trend}</span>` : ''}</div></div>
        <div class="stat-card"><div class="stat-value">${parseInt(pv.last_month).toLocaleString('nb-NO')}</div><div class="stat-label">Forrige måned</div></div>
        <div class="stat-card"><div class="stat-value">${Math.round(Object.values(days).reduce((a,b)=>a+b,0)/30)}</div><div class="stat-label">Snitt per dag (30 dager)</div></div>
      </div>
      <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:28px;margin-bottom:24px;">
        <h3 style="margin-bottom:20px;">Sidevisninger siste 30 dager</h3>
        <div id="chartPageViews" style="display:flex;align-items:flex-end;gap:4px;height:160px;padding-bottom:28px;position:relative;border-bottom:2px solid rgba(0,0,0,0.07);"></div>
      </div>
      <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:28px;margin-bottom:24px;">
        <h3 style="margin-bottom:20px;">Populære sider</h3>
        <div id="chartByPage"></div>
      </div>

      <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:28px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
          <h3 style="margin:0;">Bla i en enkelt dag</h3>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-outline btn-sm" onclick="flyttDagvisning(-1)">← Forrige</button>
            <input type="date" id="dagVelger" class="form-input" style="max-width:170px;" onchange="lastDagvisning()">
            <button class="btn btn-outline btn-sm" onclick="flyttDagvisning(1)">Neste →</button>
          </div>
        </div>
        <div id="dagvisningInnhold" style="opacity:0.5;">Laster...</div>
      </div>

      <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:28px;margin-bottom:24px;">
        <h3 style="margin-bottom:4px;">Detaljert statistikk</h3>
        <p id="detaljerStatus" style="font-size:0.8rem;opacity:0.55;margin-bottom:20px;"></p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;">
          <div>
            <h4 style="font-size:0.9rem;margin-bottom:12px;opacity:0.8;">Kilde (hvor de kom fra)</h4>
            <div id="chartKilde"></div>
          </div>
          <div>
            <h4 style="font-size:0.9rem;margin-bottom:12px;opacity:0.8;">Enhet</h4>
            <div id="chartEnhet"></div>
          </div>
        </div>
        <div style="margin-top:24px;">
          <h4 style="font-size:0.9rem;margin-bottom:12px;opacity:0.8;">Tid på døgnet</h4>
          <div id="chartTidDogn"></div>
        </div>
      </div>

      <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:24px 28px;">
        <h3 style="margin-bottom:14px;">Dine egne besøk</h3>
        <p id="sporStatus" style="font-size:0.9rem;margin-bottom:16px;"></p>
        <p style="font-size:0.85rem;opacity:0.7;line-height:1.7;margin-bottom:16px;">
          Nettleseren merkes automatisk når du logger inn her. På mobilen din, eller
          en annen nettleser, åpner du denne lenken én gang:<br>
          <a href="https://kakefrue.no/?ikkespor=1" target="_blank"
             style="font-family:monospace;font-size:0.82rem;">kakefrue.no/?ikkespor=1</a>
        </p>
        <button class="btn btn-outline btn-sm" onclick="nullstillStatistikk()"
                style="border-color:rgba(200,0,0,0.3);color:#c00;">
          Nullstill all statistikk
        </button>
        <span style="font-size:0.8rem;opacity:0.6;margin-left:10px;">
          Sletter alle tall og starter telling på nytt fra i dag.
        </span>
      </div>
    `;

    const merket = document.cookie.split(';').some(c => c.trim() === 'kf_ikkespor=1');
    document.getElementById('sporStatus').innerHTML = merket
      ? '<span style="color:var(--sage);">✓ Denne nettleseren telles ikke med.</span>'
      : '<span style="color:#C62828;">⚠ Denne nettleseren telles med i statistikken. Logg ut og inn igjen for å merke den.</span>';

    renderBarChart('chartPageViews', days, v => v, '#8B72BE');
    const pageTotal = pv.byPage.reduce((s, p) => s + parseInt(p.count), 0) || 1;
    renderPillList('chartByPage', Object.fromEntries(pv.byPage.map(p => [p.page, parseInt(p.count)])), pageTotal);

    if (!document.getElementById('dagVelger').value) {
      document.getElementById('dagVelger').value = new Date().toISOString().slice(0, 10);
    }
    lastDagvisning();
    lastDetaljertStatistikk();
  } catch (e) { console.error(e); }
}

function flyttDagvisning(delta) {
  const felt = document.getElementById('dagVelger');
  const d = new Date(felt.value + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  felt.value = d.toISOString().slice(0, 10);
  lastDagvisning();
}

async function lastDagvisning() {
  const dato = document.getElementById('dagVelger').value;
  const el = document.getElementById('dagvisningInnhold');
  el.style.opacity = '0.5';
  try {
    const d = await api('/api/admin/pageviews/dag?dato=' + dato);
    const datoTekst = new Date(dato + 'T12:00:00').toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (!d.byPage.length) {
      el.innerHTML = `<p style="opacity:0.6;">Ingen registrerte besøk ${datoTekst}.</p>`;
    } else {
      el.innerHTML = `
        <p style="margin-bottom:14px;"><strong>${d.total}</strong> sidevisninger ${datoTekst}</p>
        ${d.byPage.map(p => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(0,0,0,0.05);font-size:0.9rem;">
            <span>${p.page}</span><span style="font-weight:700;">${p.count}</span>
          </div>
        `).join('')}
      `;
    }
    el.style.opacity = '1';
  } catch (e) { el.innerHTML = '<p style="opacity:0.5;">Kunne ikke laste.</p>'; }
}

async function lastDetaljertStatistikk() {
  try {
    const d = await api('/api/admin/pageviews/detaljer');
    document.getElementById('detaljerStatus').textContent = d.total
      ? `Basert på ${d.total} besøk, registrert fra ${new Date(d.forste).toLocaleDateString('nb-NO')} (data finnes kun fra denne datoen og fremover, ikke bakover i tid).`
      : 'Ingen detaljerte data ennå.';

    const kildeData = Object.fromEntries(d.kilde.map(k => [k.kilde, parseInt(k.count)]));
    const kildeTotal = d.kilde.reduce((s, k) => s + parseInt(k.count), 0) || 1;
    renderPillList('chartKilde', kildeData, kildeTotal);

    const enhetData = Object.fromEntries(d.enhet.map(k => [k.enhet, parseInt(k.count)]));
    const enhetTotal = d.enhet.reduce((s, k) => s + parseInt(k.count), 0) || 1;
    renderPillList('chartEnhet', enhetData, enhetTotal);

    // Slar de 24 timene sammen til lesbare deler av dognet
    const bolker = { 'Natt (00–05)': 0, 'Morgen (06–09)': 0, 'Formiddag (10–13)': 0, 'Ettermiddag (14–17)': 0, 'Kveld (18–21)': 0, 'Sen kveld (22–23)': 0 };
    d.timer.forEach(t => {
      const time = parseInt(t.time), count = parseInt(t.count);
      if (time <= 5) bolker['Natt (00–05)'] += count;
      else if (time <= 9) bolker['Morgen (06–09)'] += count;
      else if (time <= 13) bolker['Formiddag (10–13)'] += count;
      else if (time <= 17) bolker['Ettermiddag (14–17)'] += count;
      else if (time <= 21) bolker['Kveld (18–21)'] += count;
      else bolker['Sen kveld (22–23)'] += count;
    });
    // Egen (usortert) rendering her - renderPillList sorterer etter storst
    // forst, men for tid pa dognet skal rekkefolgen vaere kronologisk.
    const tidTotal = Object.values(bolker).reduce((a, b) => a + b, 0) || 1;
    const tidColors = ['#8B72BE','#7A9E82','#D4A96A','#D8CCEE','#B5C9A8','#F0D5A0'];
    document.getElementById('chartTidDogn').innerHTML = Object.entries(bolker).map(([k, v], i) => {
      const pct = Math.round((v / tidTotal) * 100);
      return `<div style="margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:4px;"><span>${k}</span><span style="opacity:0.6;">${v} (${pct}%)</span></div>
        <div style="background:rgba(0,0,0,0.06); border-radius:100px; height:8px; overflow:hidden;">
          <div style="width:${pct}%; background:${tidColors[i % tidColors.length]}; height:100%; border-radius:100px; transition:width 0.4s;"></div>
        </div>
      </div>`;
    }).join('');
  } catch (e) { console.error(e); }
}

async function nullstillStatistikk() {
  if (!confirm('Slette all statistikk og starte tellingen på nytt?\n\nDette kan ikke angres.')) return;
  try {
    await api('/api/admin/pageviews', { method: 'DELETE' });
    loadPageViews();
  } catch (e) {
    alert('Kunne ikke nullstille: ' + e.message);
  }
}

function renderBarChart(containerId, data, labelFn, color) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const max = Math.max(...values, 1);
  const el = document.getElementById(containerId);
  // Sokylene ma ha en kolonne med full hoyde a vokse i, ellers kollapser
  // prosenthoyden til ingenting og diagrammet blir en tynn strek.
  const maaned = keys.length && keys[0].length === 7;
  el.innerHTML = keys.map((k, i) => {
    const pct = (values[i] / max) * 100;
    const kort = maaned
      ? new Date(k + '-01').toLocaleDateString('nb-NO', { month:'short', year:'2-digit' })
      : new Date(k).toLocaleDateString('nb-NO', { day:'numeric', month:'short' });
    // Med 30 dager blir det for trangt til a merke hver stolpe
    const visMerke = maaned || keys.length <= 12 || i % 5 === 0 || i === keys.length - 1;
    return `<div style="flex:1; min-width:0; height:100%; display:flex; flex-direction:column;
                        justify-content:flex-end; align-items:center; position:relative;">
      <div style="font-size:0.62rem; opacity:0.65; margin-bottom:3px; white-space:nowrap;
                  font-variant-numeric:tabular-nums;">${values[i] > 0 ? labelFn(values[i]) : ''}</div>
      <div title="${kort}: ${values[i]}"
           style="width:100%; max-width:34px; background:${color}; border-radius:4px 4px 0 0;
                  height:${pct}%; min-height:${values[i] > 0 ? 3 : 0}px; transition:height 0.3s;"></div>
      <div style="font-size:0.6rem; opacity:0.5; white-space:nowrap; position:absolute;
                  bottom:-20px;">${visMerke ? kort : ''}</div>
    </div>`;
  }).join('');
}

function renderPillList(containerId, data, total) {
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const colors = ['#8B72BE','#7A9E82','#D4A96A','#D8CCEE','#B5C9A8','#F0D5A0'];
  document.getElementById(containerId).innerHTML = sorted.map(([k, v], i) => {
    const pct = total ? Math.round((v / total) * 100) : 0;
    return `<div style="margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:4px;"><span>${k}</span><span style="opacity:0.6;">${v} (${pct}%)</span></div>
      <div style="background:rgba(0,0,0,0.06); border-radius:100px; height:8px; overflow:hidden;">
        <div style="width:${pct}%; background:${colors[i % colors.length]}; height:100%; border-radius:100px; transition:width 0.4s;"></div>
      </div>
    </div>`;
  }).join('');
}

function initAdmin() {
  const hash = location.hash.replace('#', '');
  const validPanels = ['oversikt','kalender','bestillinger','ufullstendige','provesmaking','kurs','anbefalinger','bilder','spesial','etiketter','statistikk','innstillinger','jul'];
  const startPanel = validPanels.includes(hash) ? hash : 'oversikt';
  activatePanel(startPanel);
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
    if (s.pending_bookings > 0 && !isBadgeCleared('bestillinger')) { badgeBest.textContent = s.pending_bookings; badgeBest.style.display = ''; } else { badgeBest.style.display = 'none'; }
    const badgeUfull = $('badge-ufullstendige');
    if (s.abandoned_count > 0 && !isBadgeCleared('ufullstendige')) { badgeUfull.textContent = s.abandoned_count; badgeUfull.style.display = ''; } else { badgeUfull.style.display = 'none'; }
    const badgeProv = $('badge-provesmaking');
    if (s.pending_tastings > 0 && !isBadgeCleared('provesmaking')) { badgeProv.textContent = s.pending_tastings; badgeProv.style.display = ''; } else { badgeProv.style.display = 'none'; }
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
    <div class="modal-footer" style="flex-wrap:wrap;gap:8px;">
      <button class="btn btn-outline" style="color:#C62828;border-color:#C62828;" onclick="deleteDate(${d.id})">🗑 Slett dato</button>
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
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="openBookingDetail(${b.id})">Detaljer</button>
        ${b.email ? `<button class="btn btn-outline btn-sm" data-email="${b.email}" data-name="${b.full_name.replace(/"/g,'&quot;')}" onclick="openEmailModal(this.dataset.email, this.dataset.name)">✉️</button>` : ''}
        <button class="photo-delete-btn" style="padding:6px 11px;" title="Slett bestilling" onclick="slettBestilling(${b.id})">🗑</button>
      </td>
    </tr>
  `).join('');
}

async function slettBestilling(id) {
  if (!confirm('Slette bestilling #' + id + '? Dette kan ikke angres.')) return;
  try {
    await api('/api/admin/bookings/' + id, { method: 'DELETE' });
    loadBookings();
  } catch (e) {
    alert('Kunne ikke slette: ' + e.message);
  }
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
          ${r.phone ? `<button class="btn btn-primary btn-sm" data-id="${r.id}" data-phone="${r.phone}" data-name="${r.full_name.replace(/"/g,'&quot;')}" onclick="openSmsModal(this.dataset.id, this.dataset.phone, this.dataset.name)">📱 SMS</button>` : ''}
          ${r.email ? `<button class="btn btn-outline btn-sm" data-email="${r.email}" data-name="${r.full_name.replace(/"/g,'&quot;')}" onclick="openEmailModal(this.dataset.email, this.dataset.name)">✉️ E-post</button>` : ''}
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
    // SMS not configured – fall back to sms: link (opens phone app / Messages)
    const smsUrl = `sms:${activeSmsPhone}${/iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(message)}`;
    window.open(smsUrl);
    showAlert('Åpner SMS-app ✓', 'success');
    await markContacted(activeSmsId).catch(() => {});
    closeSmsModal();
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
  $('emailModalOverlay').classList.remove('hidden');
}

function closeEmailModal() {
  $('emailModalOverlay').classList.add('hidden');
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
    const result = await api('/api/admin/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: activeEmailTo, name: activeEmailName, subject, message })
    });
    if (result.mailto_fallback) {
      // SMTP not configured – open mail client instead
      const mailtoUrl = `mailto:${activeEmailTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
      window.open(mailtoUrl);
      showAlert('Åpner e-postklient ✓', 'success');
    } else {
      showAlert('E-post sendt! ✓', 'success');
    }
    closeEmailModal();
  } catch (e) {
    // Last resort fallback
    const mailtoUrl = `mailto:${activeEmailTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
    window.open(mailtoUrl);
    showAlert('Åpner e-postklient ✓', 'success');
    closeEmailModal();
  } finally {
    btn.textContent = 'Send e-post';
    btn.disabled = false;
  }
}

// ── Tastings ───────────────────────────────────────────────
function proveVippsMerke(r) {
  const pille = (bg, farge, tekst) =>
    `<span style="align-self:center;background:${bg};color:${farge};border-radius:100px;padding:5px 11px;font-size:0.76rem;font-weight:700;white-space:nowrap;">${tekst}</span>`;
  if (!r.vipps_reference) return pille('rgba(0,0,0,.05)', '#8A6858', 'Ikke betalt');
  if (r.vipps_refunded_at) return pille('rgba(0,0,0,.06)', '#6B5040', '↩️ Refundert');
  if (r.vipps_captured_at) return pille('rgba(122,158,130,.2)', '#4A7A5A', '💰 Betalt') +
    `<button class="btn btn-outline btn-sm" onclick="proveVippsRefunder(${r.id}, this)">Refunder</button>`;
  if (r.vipps_state === 'AUTHORIZED') return pille('rgba(255,91,36,.12)', '#C2410C', '🔒 Reservert') +
    `<button class="btn btn-primary btn-sm" style="background:#FF5B24;border-color:#FF5B24;color:#fff;" onclick="proveVippsTrekk(${r.id}, this)">Trekk beløpet</button>` +
    `<button class="btn btn-outline btn-sm" onclick="proveVippsRefunder(${r.id}, this)">Frigjør</button>`;
  if (['ABORTED', 'EXPIRED', 'TERMINATED'].includes(r.vipps_state)) return pille('rgba(196,120,138,.16)', '#9B3A52', 'Avbrutt – ikke betalt');
  return pille('rgba(0,0,0,.05)', '#8A6858', 'Venter på Vipps');
}

async function proveVippsTrekk(id, btn) {
  if (!confirm('Trekke beløpet fra kunden nå?')) return;
  btn.disabled = true;
  try {
    const r = await api('/api/admin/tastings/' + id + '/vipps-trekk', { method: 'POST' });
    showAlert(r.trukket ? 'Beløpet er trukket' : 'Ingenting å trekke – betalingen er ikke godkjent eller allerede trukket', r.trukket ? 'success' : 'info');
    loadTastings();
  } catch (e) {
    alert('Kunne ikke trekke beløpet: ' + e.message);
    btn.disabled = false;
  }
}

async function proveVippsRefunder(id, btn) {
  if (!confirm('Refundere/frigjøre denne prøvesmakingen i Vipps?\n\nDette kan ikke angres.')) return;
  btn.disabled = true;
  try {
    await api('/api/admin/tastings/' + id + '/vipps-refunder', { method: 'POST' });
    showAlert('Refundert/frigjort i Vipps', 'success');
    loadTastings();
  } catch (e) {
    alert('Vipps sa nei: ' + e.message);
    btn.disabled = false;
  }
}

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
        <td><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${proveVippsMerke(r)}</div></td>
        <td style="display:flex;gap:6px;">
          <button class="btn btn-outline btn-sm" onclick="openTastingModal(${JSON.stringify(r).replace(/"/g,'&quot;')})">Rediger</button>
          <button class="btn btn-outline btn-sm" style="color:#C62828;border-color:#C62828;" onclick="deleteTasting(${r.id})">Slett</button>
        </td>
      </tr>
    `).join('');
  } catch {}
}

async function deleteTasting(id) {
  if (!confirm('Slette denne prøvesmakingen?')) return;
  try {
    await api('/api/admin/tastings/' + id, { method: 'DELETE' });
    loadTastings();
  } catch (e) { alert('Kunne ikke slette: ' + e.message); }
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
      <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="m-t-paid" ${t.paid?'checked':''}> Betalt (kr 500)</label></div>
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
async function loadCourseRegistrations() {
  try {
    const rows = await api('/api/admin/course-registrations');
    const container = $('courseRegistrationsList');
    if (!rows.length) {
      container.innerHTML = '<p style="opacity:0.5;">Ingen påmeldinger ennå.</p>';
      return;
    }
    const byCourse = {};
    rows.forEach(r => {
      if (!byCourse[r.course_title]) byCourse[r.course_title] = [];
      byCourse[r.course_title].push(r);
    });
    container.innerHTML = Object.entries(byCourse).map(([title, people]) => `
      <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:24px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h4 style="margin:0;">${title}</h4>
          <span class="tag tag-sage">${people.length} påmeldt</span>
        </div>
        <table class="data-table" style="width:100%;">
          <thead><tr><th>Navn</th><th>Kontakt</th><th>Betaling</th><th>Dato</th><th></th></tr></thead>
          <tbody>
            ${people.map(p => `
              <tr>
                <td><strong>${p.full_name}</strong></td>
                <td style="display:flex;gap:6px;flex-wrap:wrap;">
                  <a href="tel:${p.phone}" class="btn btn-outline btn-sm">📞 ${p.phone}</a>
                  <button class="btn btn-outline btn-sm" data-email="${p.email}" data-name="${p.full_name.replace(/"/g,'&quot;')}" onclick="openEmailModal(this.dataset.email,this.dataset.name)">✉️</button>
                </td>
                <td><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${kursVippsMerke(p)}</div></td>
                <td>${formatDate(p.created_at)}</td>
                <td><button class="btn btn-outline btn-sm" style="color:#C62828;border-color:#C62828;" onclick="deleteCourseRegistration(${p.id})">Slett</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('');
  } catch (e) { console.error(e); }
}

async function deleteCourseRegistration(id) {
  if (!confirm('Slette denne påmeldingen? Husk å refundere i Vipps FØRST hvis den er betalt - sletting alene gir ikke pengene tilbake til kunden.')) return;
  try {
    await api('/api/admin/course-registrations/' + id, { method: 'DELETE' });
    loadCourseRegistrations();
    loadCourses();
  } catch (e) { alert('Kunne ikke slette: ' + e.message); }
}

async function loadCourseInterests() {
  try {
    const rows = await api('/api/admin/course-interests');
    const container = $('courseInterestsList');
    if (!rows.length) {
      container.innerHTML = '<p style="opacity:0.5;">Ingen har meldt interesse ennå.</p>';
      return;
    }
    // Group by course
    const byCourse = {};
    rows.forEach(r => {
      if (!byCourse[r.course_title]) byCourse[r.course_title] = [];
      byCourse[r.course_title].push(r);
    });
    container.innerHTML = Object.entries(byCourse).map(([title, people]) => `
      <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:24px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h4 style="margin:0;">${title}</h4>
          <span class="tag tag-sage">${people.length} interesserte</span>
        </div>
        <table class="data-table" style="width:100%;">
          <thead><tr><th>Navn</th><th>Telefon</th><th>Dato</th><th></th></tr></thead>
          <tbody>
            ${people.map(p => `
              <tr>
                <td><strong>${p.full_name}</strong></td>
                <td><a href="tel:${p.phone}">${p.phone}</a></td>
                <td>${formatDate(p.created_at)}</td>
                <td><button class="btn btn-outline btn-sm" style="color:#C62828;border-color:#C62828;" onclick="deleteCourseInterest(${p.id})">Slett</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('');
  } catch (e) { console.error(e); }
}

async function deleteCourseInterest(id) {
  if (!confirm('Slette denne interessen?')) return;
  try {
    await api('/api/admin/course-interests/' + id, { method: 'DELETE' });
    loadCourseInterests();
  } catch (e) { console.error(e); }
}

let _alleKurs = []; // cache - unngar a proppe hele kursobjektet (inkl. evt. base64-bilde) inn i et onclick-attributt

async function loadCourses() {
  try {
    const courses = await api('/api/admin/courses');
    _alleKurs = courses;
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
            <button class="btn btn-outline btn-sm" onclick="openCourseModal(${c.id})">Rediger</button>
            <button class="btn btn-outline btn-sm" style="color:#C62828;border-color:#C62828;" onclick="deleteCourse(${c.id})">Slett</button>
          </div>
        </div>
        ${c.description ? `<p style="font-size:0.9rem;opacity:0.7;margin-top:12px;margin-bottom:0;">${c.description}</p>` : ''}
      </div>
    `).join('');
  } catch {}
}

let _kursBildeData = null; // {data, mimeType} for nylig valgt/komprimert bilde, 'FJERNET' for eksplisitt fjernet, null = ikke endret
let _kursRedigeres = null; // kurset som redigeres, sa saveCourse() finner eksisterende image_url

function openCourseModal(id = null) {
  const c = id ? _alleKurs.find(x => x.id === id) : null;
  _kursBildeData = null;
  _kursRedigeres = c;
  openModal(`
    <div class="modal-header"><h3>${c ? 'Rediger kurs' : 'Nytt kurs'}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div id="courseModalErr" class="alert alert-error hidden"></div>
      <div class="form-group"><label class="form-label">Tittel *</label><input class="form-input" id="m-c-title" type="text" value="${c ? c.title : ''}"></div>
      <div class="form-group"><label class="form-label">Beskrivelse</label><textarea class="form-textarea" id="m-c-desc" rows="3">${c ? (c.description||'') : ''}</textarea></div>
      <div class="form-group">
        <label class="form-label">Bilde</label>
        <div id="kursBildePreview" style="margin-bottom:8px;">
          ${c && c.image_url ? `<img src="${c.image_url}" alt="" style="width:100%;max-height:160px;object-fit:cover;border-radius:var(--radius-sm);">` : '<p style="font-size:0.8rem;opacity:0.5;margin:0;">Ingen bilde valgt</p>'}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <label class="btn btn-outline btn-sm" style="cursor:pointer;">
            ${c && c.image_url ? '🔄 Bytt bilde' : '📷 Legg til bilde'}
            <input type="file" accept="image/*" style="display:none;" onchange="velgKursBilde(this)">
          </label>
          ${c && c.image_url ? `<button type="button" class="btn btn-outline btn-sm" onclick="fjernKursBilde()">✕ Fjern bilde</button>` : ''}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="form-group"><label class="form-label">Dato</label><input class="form-input" id="m-c-date" type="date" value="${c && c.date ? c.date.substring(0,10) : ''}"></div>
        <div class="form-group"><label class="form-label">Starttid</label><input class="form-input" id="m-c-time" type="time" value="${c && c.time_start ? c.time_start.substring(0,5) : ''}"></div>
        <div class="form-group"><label class="form-label">Varighet (timer)</label><input class="form-input" id="m-c-dur" type="number" value="${c ? c.duration_hours : 3}" style="max-width:100px;"></div>
        <div class="form-group"><label class="form-label">Pris (kr)</label><input class="form-input" id="m-c-price" type="number" value="${c ? (c.price||'') : ''}"></div>
        <div class="form-group"><label class="form-label">Maks deltakere</label><input class="form-input" id="m-c-max" type="number" value="${c ? c.max_participants : 4}" style="max-width:100px;"></div>
      </div>
      <div class="form-group"><label class="form-label">Adresse (møtested)</label><input class="form-input" id="m-c-address" type="text" placeholder="Vises kun i bekreftelses-e-posten, ikke offentlig" value="${c ? (c.address||'') : ''}"></div>
      <div class="form-group"><label class="form-label">Ta med</label><input class="form-input" id="m-c-bring" type="text" value="${c ? (c.what_to_bring||'') : ''}"></div>
      ${c ? `<div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="m-c-active" ${c.active?'checked':''}> Aktiv (synlig på nettside)</label></div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Avbryt</button>
      <button class="btn btn-primary" onclick="saveCourse(${c ? c.id : 'null'})">${c ? 'Oppdater' : 'Opprett kurs'}</button>
    </div>
  `);
}

async function velgKursBilde(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const { data, mimeType } = await compressImage(file, 1600, 0.82);
    _kursBildeData = { data, mimeType };
    $('kursBildePreview').innerHTML = `<img src="data:${mimeType};base64,${data}" alt="" style="width:100%;max-height:160px;object-fit:cover;border-radius:var(--radius-sm);">`;
  } catch (e) { alert('Kunne ikke lese bildet: ' + e.message); }
}
function fjernKursBilde() {
  _kursBildeData = 'FJERNET';
  $('kursBildePreview').innerHTML = '<p style="font-size:0.8rem;opacity:0.5;margin:0;">Ingen bilde valgt</p>';
}

async function saveCourse(id) {
  const title = $('m-c-title').value.trim();
  if (!title) { $('courseModalErr').textContent='Tittel er påkrevd'; $('courseModalErr').classList.remove('hidden'); return; }
  let image_url;
  if (_kursBildeData === 'FJERNET') image_url = null;
  else if (_kursBildeData) image_url = `data:${_kursBildeData.mimeType};base64,${_kursBildeData.data}`;
  else image_url = _kursRedigeres ? (_kursRedigeres.image_url || null) : null;
  const body = {
    title, description: $('m-c-desc').value,
    date: $('m-c-date').value || null,
    time_start: $('m-c-time').value || null,
    duration_hours: parseInt($('m-c-dur').value) || 3,
    price: parseFloat($('m-c-price').value) || null,
    max_participants: parseInt($('m-c-max').value) || 4,
    what_to_bring: $('m-c-bring').value || null,
    address: $('m-c-address').value || null,
    active: $('m-c-active') ? $('m-c-active').checked : true,
    image_url
  };
  try {
    if (id) await api('/api/admin/courses/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/admin/courses', { method: 'POST', body: JSON.stringify(body) });
    closeModal(); loadCourses();
  } catch (e) { $('courseModalErr').textContent=e.message; $('courseModalErr').classList.remove('hidden'); }
}

async function deleteCourse(id) {
  if (!confirm('Slette dette kurset?')) return;
  try {
    await api('/api/admin/courses/' + id, { method: 'DELETE' });
    loadCourses();
  } catch (e) {
    alert('Kunne ikke slette kurset: ' + e.message);
  }
}

function kursVippsMerke(r) {
  const pille = (bg, farge, tekst) =>
    `<span style="align-self:center;background:${bg};color:${farge};border-radius:100px;padding:5px 11px;font-size:0.76rem;font-weight:700;white-space:nowrap;">${tekst}</span>`;
  if (!r.vipps_reference) return pille('rgba(0,0,0,.05)', '#8A6858', 'Ikke betalt');
  if (r.vipps_refunded_at) return pille('rgba(0,0,0,.06)', '#6B5040', '↩️ Refundert');
  if (r.vipps_captured_at) return pille('rgba(122,158,130,.2)', '#4A7A5A', '💰 Betalt') +
    `<button class="btn btn-outline btn-sm" onclick="kursVippsRefunder(${r.id}, this)">Refunder</button>`;
  if (r.vipps_state === 'AUTHORIZED') return pille('rgba(255,91,36,.12)', '#C2410C', '🔒 Reservert') +
    `<button class="btn btn-primary btn-sm" style="background:#FF5B24;border-color:#FF5B24;color:#fff;" onclick="kursVippsTrekk(${r.id}, this)">Trekk beløpet</button>` +
    `<button class="btn btn-outline btn-sm" onclick="kursVippsRefunder(${r.id}, this)">Frigjør</button>`;
  if (['ABORTED', 'EXPIRED', 'TERMINATED'].includes(r.vipps_state)) return pille('rgba(196,120,138,.16)', '#9B3A52', 'Avbrutt – ikke betalt');
  return pille('rgba(0,0,0,.05)', '#8A6858', 'Venter på Vipps');
}

async function kursVippsTrekk(id, btn) {
  if (!confirm('Trekke beløpet fra kunden nå?')) return;
  btn.disabled = true;
  try {
    const r = await api('/api/admin/course-registrations/' + id + '/vipps-trekk', { method: 'POST' });
    showAlert(r.trukket ? 'Beløpet er trukket' : 'Ingenting å trekke – betalingen er ikke godkjent eller allerede trukket', r.trukket ? 'success' : 'info');
    if (window._kursRegModalId) viewRegistrations(window._kursRegModalId, window._kursRegModalTitle);
    loadCourseRegistrations();
  } catch (e) {
    alert('Kunne ikke trekke beløpet: ' + e.message);
    btn.disabled = false;
  }
}

async function kursVippsRefunder(id, btn) {
  if (!confirm('Refundere/frigjøre denne påmeldingen i Vipps?\n\nKunden mister plassen sin, og dette kan ikke angres.')) return;
  btn.disabled = true;
  try {
    await api('/api/admin/course-registrations/' + id + '/vipps-refunder', { method: 'POST' });
    showAlert('Refundert/frigjort i Vipps', 'success');
    if (window._kursRegModalId) viewRegistrations(window._kursRegModalId, window._kursRegModalTitle);
    loadCourseRegistrations();
    loadCourses();
  } catch (e) {
    alert('Vipps sa nei: ' + e.message);
    btn.disabled = false;
  }
}

async function viewRegistrations(courseId, title) {
  window._kursRegModalId = courseId;
  window._kursRegModalTitle = title;
  try {
    const regs = await api('/api/admin/courses/' + courseId + '/registrations');
    openModal(`
      <div class="modal-header"><h3>Påmeldinger – ${title}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        ${regs.length ? `
          <table class="data-table" style="width:100%;">
            <thead><tr><th>Navn</th><th>Telefon</th><th>E-post</th><th>Betaling</th><th>Dato</th></tr></thead>
            <tbody>${regs.map(r => `<tr><td>${r.full_name}</td><td>${r.phone}</td><td>${r.email}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${kursVippsMerke(r)}</div></td><td>${formatDate(r.created_at)}</td></tr>`).join('')}</tbody>
          </table>` : '<p style="text-align:center;opacity:0.5;padding:24px;">Ingen påmeldinger ennå</p>'}
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Lukk</button></div>
    `);
  } catch {}
}

// ── Reviews ────────────────────────────────────────────────
let allReviews = [];

async function loadReviews() {
  try {
    allReviews = await api('/api/admin/reviews');
    renderReviews();
  } catch {}
}

function renderReviews() {
  const tbody = $('reviewsTableBody');
  if (!allReviews.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;opacity:0.5;">Ingen anbefalinger ennå</td></tr>';
    return;
  }
  tbody.innerHTML = allReviews.map((r, i) => `
    <tr id="review-row-${r.id}">
      <td>
        <div class="photo-sorter">
          <span style="font-size:0.75rem;font-weight:700;color:var(--gold);text-align:center;">${i + 1}</span>
          <button class="photo-pil" onclick="moveReview(${i}, -1)" ${i === 0 ? 'disabled' : ''} title="Flytt opp">▲</button>
          <button class="photo-pil" onclick="moveReview(${i}, 1)" ${i === allReviews.length - 1 ? 'disabled' : ''} title="Flytt ned">▼</button>
        </div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          ${r.image_url ? `<img src="${r.image_url}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;flex-shrink:0;">` : ''}
          <strong>${r.customer_name || '—'}</strong>
        </div>
      </td>
      <td style="max-width:220px;">
        <span style="opacity:0.7;font-size:0.88rem;">${(r.review_text || '').slice(0, 60)}${r.review_text && r.review_text.length > 60 ? '…' : ''}</span>
        <button class="btn btn-outline btn-sm" style="margin-left:6px;padding:2px 8px;font-size:0.75rem;" onclick="openReviewDetail(${i})">Les</button>
      </td>
      <td>${r.approved ? '<span style="color:var(--sage);">✓ Synlig</span>' : '<span style="color:#C62828;">Skjult</span>'}</td>
      <td>${formatDate(r.created_at)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="toggleApproved(${r.id}, ${!r.approved})">${r.approved ? 'Skjul' : 'Godkjenn'}</button>
        <label class="btn btn-outline btn-sm" style="cursor:pointer;" title="${r.image_url ? 'Bytt bilde' : 'Legg til bilde av kaken'}">
          ${r.image_url ? '🔄 Bytt bilde' : '📷 Legg til bilde'}
          <input type="file" accept="image/*" style="display:none;" onchange="velgAnbefalingsbilde(${r.id}, this)">
        </label>
        ${r.image_url ? `<button class="btn btn-outline btn-sm" onclick="fjernAnbefalingsbilde(${r.id})" title="Fjern bildet">✕ Bilde</button>` : ''}
        <button class="btn btn-outline btn-sm" style="color:#C62828;border-color:#C62828;" onclick="deleteReview(${r.id})">Slett</button>
      </td>
    </tr>
  `).join('');
}

function openReviewDetail(index) {
  const r = allReviews[index];
  if (!r) return;
  openModal(`
    <div class="modal-header">
      <h3>Anbefaling fra ${r.customer_name || 'Ukjent'}</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p style="font-size:0.85rem;opacity:0.5;margin-bottom:16px;">${r.approved ? '<span style="color:var(--sage);">Synlig på siden</span>' : '<span style="color:#C62828;">Ikke godkjent ennå</span>'}</p>
      ${r.image_url ? `<img src="${r.image_url}" alt="Bilde fra kunden" style="width:100%;max-height:340px;object-fit:cover;border-radius:var(--radius-sm);margin-bottom:16px;">` : ''}
      <div style="background:var(--cream);border-radius:var(--radius-sm);padding:20px;font-style:italic;line-height:1.8;font-size:1rem;">
        "${r.review_text || ''}"
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Lukk</button>
      <button class="btn btn-primary" onclick="toggleApproved(${r.id}, ${!r.approved}); closeModal();">${r.approved ? 'Skjul' : 'Godkjenn'}</button>
    </div>
  `);
}

async function velgAnbefalingsbilde(id, input) {
  const fil = input.files && input.files[0];
  if (!fil) return;
  input.value = '';
  if (!fil.type.startsWith('image/')) { alert('Velg en bildefil.'); return; }
  try {
    const { data, mimeType } = await compressImage(fil, 1100, 0.78);
    await api('/api/admin/reviews/' + id, {
      method: 'PUT',
      body: JSON.stringify({ image_url: `data:${mimeType};base64,${data}` })
    });
    loadReviews();
  } catch (e) {
    alert('Kunne ikke lagre bildet: ' + e.message);
  }
}

async function fjernAnbefalingsbilde(id) {
  if (!confirm('Fjerne bildet fra denne anbefalingen?')) return;
  try {
    await api('/api/admin/reviews/' + id, { method: 'PUT', body: JSON.stringify({ image_url: null }) });
    loadReviews();
  } catch (e) {
    alert('Kunne ikke fjerne bildet: ' + e.message);
  }
}

async function moveReview(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= allReviews.length) return;
  // Swap
  [allReviews[index], allReviews[newIndex]] = [allReviews[newIndex], allReviews[index]];
  renderReviews();
  // Save new order
  try {
    await api('/api/admin/reviews/reorder', {
      method: 'POST',
      body: JSON.stringify({ order: allReviews.map((r, i) => ({ id: r.id, sort_order: i })) })
    });
  } catch (e) { console.error(e); }
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
    if ($('set-tasting')) $('set-tasting').value = s.tasting_price || 500;
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

// ============================================================
// Etiketter – merking av ferdigpakkede produkter
// ============================================================
const ALLERGENER = [
  'Gluten', 'Skalldyr', 'Egg', 'Fisk', 'Peanøtter', 'Soya', 'Melk',
  'Nøtter', 'Selleri', 'Sennep', 'Sesamfrø', 'Sulfitt', 'Lupin', 'Bløtdyr'
];

// Avsender pa etiketten – lovpalagt: navn og adresse pa virksomheten
// avs[0] vises stort som merkevarenavnet. Resten (juridisk enhet + adresse - lovpalagt
// for sporbarhet) vises som diskre finskrift under. Bytt til bare "Kakefrue" i avs[0]
// og fjern Niax-linjen naar det formelle navnebyttet er gjennomfort.
const ETIKETT_AVSENDER = [
  'Kakefrue',
  'Niax Consulting AS · Storgata 157D, 3915 Porsgrunn'
];

let etikettProdukter = [];

// Gjor tekst trygg i HTML – navn og ingredienser skrives fritt inn
function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Julebestilling-produkter (produktene pa jul.html) ───────
let julProdukter = [];

// Lager en intern nokkel av produktnavnet, unik blant de andre produktene.
// Vises aldri for kunden - brukes bare til a holde styr pa handlekurv/bestilling.
function julSlug(navn, unngaaListe) {
  const base = String(navn).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '') || 'produkt';
  let k = base, i = 2;
  while (unngaaListe.includes(k)) { k = base + i; i++; }
  return k;
}

async function loadJulProdukter() {
  try {
    const s = await api('/api/admin/settings');
    julProdukter = s.jul_produkter ? JSON.parse(s.jul_produkter) : [];
  } catch (e) {
    julProdukter = [];
  }
  renderJulProduktListe();
}

async function lagreJulProdukter() {
  await api('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify({ jul_produkter: JSON.stringify(julProdukter) })
  });
}

function renderJulProduktListe() {
  const el = $('julProduktListe');
  if (!el) return;

  if (!julProdukter.length) {
    el.innerHTML = `
      <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);
                  padding:40px 28px;text-align:center;">
        <p style="opacity:0.6;margin-bottom:18px;">Ingen produkter ennå. Julesiden viser ingenting å bestille før du legger inn minst ett.</p>
        <button class="btn btn-primary btn-sm" onclick="nyttJulProdukt()">+ Nytt produkt</button>
      </div>`;
    return;
  }

  el.innerHTML = `<div style="display:grid;gap:12px;">` + julProdukter.map((p, i) => `
    <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);
                padding:18px 22px;display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;">
      <div style="flex:1;min-width:220px;">
        <h4 style="margin:0 0 6px;font-size:1.02rem;">
          ${esc(p.n)}
          ${p.hit ? `<span style="background:#8B1A1A;color:#fff;font-size:0.68rem;font-weight:700;
            padding:3px 9px;border-radius:100px;margin-left:6px;vertical-align:middle;letter-spacing:0.03em;">HIT</span>` : ''}
          ${p.popular ? `<span style="background:rgba(122,158,130,0.18);color:#3D6B48;font-size:0.68rem;
            font-weight:700;padding:3px 9px;border-radius:100px;margin-left:6px;vertical-align:middle;letter-spacing:0.03em;">POPULÆR</span>` : ''}
        </h4>
        <p style="font-size:0.83rem;opacity:0.65;margin:0 0 8px;line-height:1.55;">
          ${esc(p.unit || '—')}${p.desc ? ' · ' + esc(p.desc) : ''}
        </p>
        <div style="font-size:0.95rem;font-weight:700;color:#8B1A1A;">
          ${p.pris},-${p.gfEkstra ? ` <span style="font-size:0.78rem;font-weight:500;opacity:0.65;">(+${p.gfEkstra} kr glutenfri)</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-outline btn-sm" onclick="redigerJulProdukt(${i})">Rediger</button>
        <button class="btn btn-outline btn-sm" onclick="slettJulProdukt(${i})"
                style="border-color:rgba(200,0,0,0.25);color:#c00;">Slett</button>
      </div>
    </div>`).join('') + `</div>`;
}

function nyttJulProdukt() { julProduktSkjema(null); }
function redigerJulProdukt(i) { julProduktSkjema(i); }

function julProduktSkjema(index) {
  const p = index === null
    ? { k: '', n: '', unit: '', pris: '', desc: '', hit: false, popular: false, gfEkstra: '' }
    : julProdukter[index];

  openModal(`
    <div class="modal-header">
      <h3>${index === null ? 'Nytt produkt' : 'Rediger produkt'}</h3>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Produktnavn</label>
        <input class="form-input" id="jpNavn" value="${esc(p.n)}" placeholder="f.eks. Kling">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group">
          <label class="form-label">Mengde / enhet</label>
          <input class="form-input" id="jpUnit" value="${esc(p.unit || '')}" placeholder="f.eks. 2 stk">
        </div>
        <div class="form-group">
          <label class="form-label">Pris (kr)</label>
          <input type="number" class="form-input" id="jpPris" value="${p.pris}" min="0" step="1">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Beskrivelse</label>
        <textarea class="form-input" id="jpDesc" rows="2"
          placeholder="Kort tekst kunden ser under produktet">${esc(p.desc || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Glutenfritt tillegg (kr)
          <span style="font-weight:300;opacity:0.6;">– valgfritt, la stå tomt hvis ikke aktuelt</span>
        </label>
        <input type="number" class="form-input" id="jpGfEkstra" value="${p.gfEkstra || ''}" min="0" step="1" placeholder="f.eks. 20">
      </div>
      <div style="display:flex;gap:20px;margin-top:4px;">
        <label style="display:flex;align-items:center;gap:8px;font-size:0.9rem;cursor:pointer;">
          <input type="checkbox" id="jpHit" ${p.hit ? 'checked' : ''} style="width:18px;height:18px;"> Merk som «HIT»
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:0.9rem;cursor:pointer;">
          <input type="checkbox" id="jpPopular" ${p.popular ? 'checked' : ''} style="width:18px;height:18px;"> Merk som «POPULÆR»
        </label>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Avbryt</button>
      <button class="btn btn-primary" onclick="lagreJulProduktSkjema(${index === null ? 'null' : index})">Lagre</button>
    </div>
  `);
}

async function lagreJulProduktSkjema(index) {
  const navn = $('jpNavn').value.trim();
  if (!navn) { alert('Produktet trenger et navn.'); return; }
  const pris = parseInt($('jpPris').value);
  if (isNaN(pris) || pris < 0) { alert('Skriv inn en gyldig pris.'); return; }
  const gfRaw = $('jpGfEkstra').value.trim();

  const eksisterendeNokler = julProdukter.filter((_, i) => i !== index).map(p => p.k);
  const k = index === null ? julSlug(navn, eksisterendeNokler) : julProdukter[index].k;

  const produkt = {
    k, n: navn,
    unit: $('jpUnit').value.trim(),
    pris,
    desc: $('jpDesc').value.trim(),
    hit: $('jpHit').checked,
    popular: $('jpPopular').checked
  };
  if (gfRaw !== '') produkt.gfEkstra = parseInt(gfRaw) || 0;

  if (index === null) julProdukter.push(produkt);
  else julProdukter[index] = produkt;

  try {
    await lagreJulProdukter();
    closeModal();
    renderJulProduktListe();
    showAlert('Lagret! ✓', 'success');
  } catch (e) {
    showAlert(e.message || 'Kunne ikke lagre', 'error');
  }
}

async function slettJulProdukt(i) {
  if (!confirm(`Slette «${julProdukter[i].n}»? Den forsvinner fra julesiden med én gang.`)) return;
  julProdukter.splice(i, 1);
  try {
    await lagreJulProdukter();
    renderJulProduktListe();
    showAlert('Slettet', 'success');
  } catch (e) {
    showAlert(e.message || 'Kunne ikke slette', 'error');
  }
}

async function loadEtiketter() {
  try {
    const s = await api('/api/admin/settings');
    etikettProdukter = s.etikett_produkter ? JSON.parse(s.etikett_produkter) : [];
  } catch (e) {
    etikettProdukter = [];
  }
  renderEtikettListe();
  fyllEtikettVelger();
  const d = $('etikDato');
  if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
}

async function lagreEtikettProdukter() {
  await api('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify({ etikett_produkter: JSON.stringify(etikettProdukter) })
  });
}

function fyllEtikettVelger() {
  const sel = $('etikProdukt');
  if (!sel) return;
  const forrige = sel.value;
  sel.innerHTML = etikettProdukter.length
    ? etikettProdukter.map((p, i) => `<option value="${i}">${esc(p.navn)}</option>`).join('')
    : '<option value="">Legg inn et produkt først</option>';
  if (forrige && etikettProdukter[forrige]) sel.value = forrige;
}

function renderEtikettListe() {
  oppdaterEtikettStatus();
  const el = $('etikettListe');
  if (!el) return;

  if (!etikettProdukter.length) {
    el.innerHTML = `
      <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);
                  padding:40px 28px;text-align:center;">
        <p style="opacity:0.6;margin-bottom:18px;line-height:1.7;">
          Ingen produkter ennå.<br>
          Legg inn ett per produkttype du pakker – lefse, krumkaker, kransekake og så videre.<br>
          Ingredienslisten skriver du bare inn én gang.
        </p>
        <button class="btn btn-primary btn-sm" onclick="leggInnJulebakst()">Legg inn julebaksten min</button>
        <button class="btn btn-outline btn-sm" onclick="nyEtikettProdukt()" style="margin-left:8px;">+ Tomt produkt</button>
      </div>`;
    return;
  }

  el.innerHTML = `<div style="display:grid;gap:12px;">` + etikettProdukter.map((p, i) => `
    <div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);
                padding:18px 22px;display:flex;gap:18px;align-items:flex-start;">
      <div style="flex:1;min-width:0;">
        <h4 style="margin:0 0 6px;font-size:1.02rem;">
          ${esc(p.navn)}
          ${p.bekreftet === false ? `<span style="background:#FFF3CD;color:#8A6100;font-size:0.68rem;
            font-weight:700;padding:3px 9px;border-radius:100px;margin-left:6px;
            vertical-align:middle;letter-spacing:0.03em;">UTKAST</span>` : ''}
        </h4>
        ${p.bekreftet === false ? `<p style="font-size:0.8rem;color:#8A6100;background:#FFF9E8;
          border-radius:8px;padding:9px 12px;margin:0 0 10px;line-height:1.55;">
          Ingredienslisten er et forslag, ikke din oppskrift. Les gjennom, rett opp,
          og trykk «Bekreft» – da forsvinner denne meldingen.
          <button class="btn btn-primary btn-sm" style="margin-left:8px;padding:4px 14px;"
                  onclick="bekreftEtikettProdukt(${i})">Bekreft</button>
        </p>` : ''}
        <p style="font-size:0.83rem;opacity:0.65;margin:0 0 8px;line-height:1.6;">${esc(p.ingredienser || '—')}</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          ${(p.allergener || []).map(a =>
            `<span style="background:rgba(198,40,40,0.09);color:#9B2C2C;font-size:0.72rem;
                          font-weight:600;padding:3px 9px;border-radius:100px;">${esc(a)}</span>`).join('')
            || '<span style="font-size:0.78rem;opacity:0.45;">Ingen allergener merket</span>'}
          <span style="font-size:0.78rem;opacity:0.55;margin-left:4px;">
            · Best før ${p.dager} ${p.dager == 1 ? 'dag' : 'dager'} etter pakking
          </span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-outline btn-sm" onclick="redigerEtikettProdukt(${i})">Rediger</button>
        <button class="btn btn-outline btn-sm" onclick="slettEtikettProdukt(${i})"
                style="border-color:rgba(200,0,0,0.25);color:#c00;">Slett</button>
      </div>
    </div>`).join('') + `</div>`;
}


// Utkast til julebakst-produktene. Ingrediensene er vanlige oppskrifter,
// IKKE Cecilies egne – derfor markeres de som ubekreftet til hun har lest gjennom.
const JULEBAKST_UTKAST = [
  { navn: 'Kling', dager: 4, mengde: '2 stk',
    ingredienser: 'meierismør, hvetemel, melis, helmelk',
    allergener: ['Gluten', 'Melk'],
    oppbevaring: 'Best de første dagene. Kan fryses.', bekreftet: false },

  { navn: 'Nordlandslefse', dager: 4, mengde: '3 stk',
    ingredienser: 'hvetemel, melk, smør, sukker, sirup, hjortetakksalt, kanel',
    allergener: ['Gluten', 'Melk'],
    oppbevaring: 'Best de første dagene. Kan fryses.', bekreftet: false },

  { navn: 'Pepperkakedrøm', dager: 5, mengde: '6 stk',
    ingredienser: 'mandler, sukker, eggehvite, smør, melis, pepperkakekrydder',
    allergener: ['Nøtter', 'Egg', 'Melk'],
    oppbevaring: 'Oppbevares kjølig.', bekreftet: false },

  { navn: 'Gule bomber', dager: 5, mengde: '6 stk',
    ingredienser: 'mandler, sukker, eggehvite, melk, eggeplomme, smør, maisenna, vanilje',
    allergener: ['Nøtter', 'Egg', 'Melk'],
    oppbevaring: 'Oppbevares kjølig.', bekreftet: false },

  { navn: 'Krumkaker', dager: 21, mengde: '6 stk',
    ingredienser: 'hvetemel, sukker, smør, egg, fløte, kardemomme',
    allergener: ['Gluten', 'Melk', 'Egg'],
    oppbevaring: 'Oppbevares tørt i tett boks.', bekreftet: false },

  { navn: 'Cookies', dager: 7, mengde: '4 stk',
    ingredienser: 'hvetemel, smør, sukker, brunt sukker, egg, sjokolade, bakepulver, vanilje',
    allergener: ['Gluten', 'Melk', 'Egg', 'Soya'],
    oppbevaring: 'Oppbevares tørt i tett boks. Kan fryses.', bekreftet: false },

  { navn: 'Kransekake', dager: 14, mengde: '18 ringer',
    ingredienser: 'mandler, melis, eggehvite',
    allergener: ['Nøtter', 'Egg'],
    oppbevaring: 'Oppbevares tørt i tett boks. Kan fryses.', bekreftet: false }
];

async function leggInnJulebakst() {
  const finnes = etikettProdukter.map(p => p.navn.toLowerCase());
  const nye = JULEBAKST_UTKAST.filter(p => !finnes.includes(p.navn.toLowerCase()));
  if (!nye.length) { alert('Alle julebakst-produktene ligger inne allerede.'); return; }

  if (!confirm(
    `Legge inn ${nye.length} produkter som utkast?\n\n` +
    'Ingredienslistene er vanlige oppskrifter, ikke dine egne. ' +
    'Du må lese gjennom hvert produkt og bekrefte det før du skriver ut etiketter.'
  )) return;

  etikettProdukter.push(...nye.map(p => ({ ...p })));
  try {
    await lagreEtikettProdukter();
    renderEtikettListe();
    fyllEtikettVelger();
  } catch (e) {
    alert('Kunne ikke lagre: ' + e.message);
  }
}

async function bekreftEtikettProdukt(i) {
  etikettProdukter[i].bekreftet = true;
  try {
    await lagreEtikettProdukter();
    renderEtikettListe();
  } catch (e) {
    alert('Kunne ikke lagre: ' + e.message);
  }
}


// Forteller rett ut hvorfor allergenene ikke vises pa julesiden enna
function oppdaterEtikettStatus() {
  const el = $('etikettStatus');
  if (!el) return;

  const utkast = etikettProdukter.filter(p => p.bekreftet === false).length;
  const ok = etikettProdukter.filter(p => p.bekreftet !== false).length;

  if (!etikettProdukter.length) {
    el.innerHTML = `<div style="background:#FFF9E8;border-left:4px solid #E0B84C;
      border-radius:8px;padding:16px 20px;line-height:1.65;">
      <strong>Ingen produkter lagt inn.</strong><br>
      Allergenene vises ikke på julesiden før produktene ligger her og er bekreftet.
      <button class="btn btn-primary btn-sm" style="margin-left:10px;"
              onclick="leggInnJulebakst()">Legg inn julebaksten min</button>
    </div>`;
    return;
  }

  if (utkast) {
    el.innerHTML = `<div style="background:#FFF9E8;border-left:4px solid #E0B84C;
      border-radius:8px;padding:16px 20px;line-height:1.65;">
      <strong>${utkast} ${utkast === 1 ? 'produkt' : 'produkter'} er ikke bekreftet.</strong><br>
      Allergenene på julesiden viser bare bekreftede produkter
      (${ok} av ${etikettProdukter.length} nå). Les gjennom ingredienslisten på hvert
      produkt nedenfor og trykk «Bekreft».
      <button class="btn btn-primary btn-sm" style="margin-left:10px;"
              onclick="bekreftAlleEtiketter()">Jeg har lest alle – bekreft</button>
    </div>`;
    return;
  }

  el.innerHTML = `<div style="background:rgba(122,158,130,0.12);border-left:4px solid #7A9E82;
    border-radius:8px;padding:16px 20px;line-height:1.65;">
    <strong>Alle ${ok} produkter er bekreftet.</strong>
    Allergenene vises nå under hvert produkt på julesiden.
    <a href="/jul.html" target="_blank" style="margin-left:6px;">Se julesiden ↗</a>
  </div>`;
}

async function bekreftAlleEtiketter() {
  const utkast = etikettProdukter.filter(p => p.bekreftet === false);
  if (!confirm(
    `Bekrefte alle ${utkast.length} produkter?\n\n` +
    'Bare gjør dette hvis du har lest gjennom ingredienslistene. ' +
    'De blir publisert som allergeninformasjon på julesiden.'
  )) return;

  etikettProdukter.forEach(p => { p.bekreftet = true; });
  try {
    await lagreEtikettProdukter();
    renderEtikettListe();
  } catch (e) {
    alert('Kunne ikke lagre: ' + e.message);
  }
}

function nyEtikettProdukt() { etikettSkjema(null); }
function redigerEtikettProdukt(i) { etikettSkjema(i); }

function etikettSkjema(index) {
  const p = index === null
    ? { navn: '', ingredienser: '', allergener: [], dager: 14, oppbevaring: '', mengde: '', bekreftet: true }
    : etikettProdukter[index];

  openModal(`
    <div class="modal-header">
      <h3>${index === null ? 'Nytt produkt' : 'Rediger produkt'}</h3>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Produktnavn</label>
        <input class="form-input" id="epNavn" value="${esc(p.navn)}" placeholder="f.eks. Lefse">
      </div>

      <div class="form-group">
        <label class="form-label">Ingredienser
          <span style="font-weight:300;opacity:0.6;">– i rekkefølge etter mengde, mest først</span>
        </label>
        <textarea class="form-input" id="epIngr" rows="3"
          placeholder="hvetemel, melk, smør, sukker, egg, hjortetakksalt">${esc(p.ingredienser)}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label">Allergener
          <span style="font-weight:300;opacity:0.6;">– huk av alt som er i produktet</span>
        </label>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(125px,1fr));gap:2px;">
          ${ALLERGENER.map(a => `
            <label style="display:flex;align-items:center;gap:8px;padding:7px 4px;
                          font-size:0.88rem;cursor:pointer;">
              <input type="checkbox" class="epAllergen" value="${a}"
                     style="width:19px;height:19px;flex-shrink:0;"
                     ${(p.allergener || []).includes(a) ? 'checked' : ''}>
              ${a}
            </label>`).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group">
          <label class="form-label">Holdbarhet i dager</label>
          <input type="number" class="form-input" id="epDager" value="${p.dager}" min="1" max="365">
        </div>
        <div class="form-group">
          <label class="form-label">Nettoinnhold <span style="font-weight:300;opacity:0.6;">– lovpålagt, f.eks. "2 stk" eller "2 stk, ca. 180 g"</span></label>
          <input class="form-input" id="epMengde" value="${esc(p.mengde || '')}" placeholder="f.eks. 2 stk, ca. 180 g">
        </div>
      </div>

      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">Oppbevaring</label>
        <input class="form-input" id="epOppb" value="${esc(p.oppbevaring || '')}"
               list="oppbForslag" placeholder="f.eks. Oppbevares tørt. Kan fryses.">
        <datalist id="oppbForslag">
          <option value="Oppbevares tørt i tett boks. Kan fryses.">
          <option value="Oppbevares tørt i tett boks.">
          <option value="Oppbevares kjølig. Kan fryses.">
          <option value="Oppbevares i kjøleskap.">
        </datalist>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Avbryt</button>
      <button class="btn btn-primary" onclick="lagreEtikettSkjema(${index === null ? 'null' : index})">Lagre</button>
    </div>
  `);
}

async function lagreEtikettSkjema(index) {
  const navn = $('epNavn').value.trim();
  if (!navn) { alert('Produktet trenger et navn.'); return; }

  const produkt = {
    navn,
    ingredienser: $('epIngr').value.trim(),
    allergener: [...document.querySelectorAll('.epAllergen:checked')].map(c => c.value),
    dager: parseInt($('epDager').value) || 14,
    mengde: $('epMengde').value.trim(),
    oppbevaring: $('epOppb').value.trim(),
    // Skriver hun det inn selv, ER det hennes bekreftelse. Redigerer hun et
    // produkt hun alt har bekreftet, skal bekreftelsen beholdes – for var
    // objektet bygget pa nytt, sa bekreftelsen forsvant usynlig og allergenene
    // sluttet a vises pa julesiden.
    bekreftet: index === null ? true : (etikettProdukter[index].bekreftet !== false)
  };

  if (index === null) etikettProdukter.push(produkt);
  else etikettProdukter[index] = produkt;

  try {
    await lagreEtikettProdukter();
    closeModal();
    renderEtikettListe();
    fyllEtikettVelger();
  } catch (e) {
    alert('Kunne ikke lagre: ' + e.message);
  }
}

async function slettEtikettProdukt(i) {
  if (!confirm(`Slette «${etikettProdukter[i].navn}»?`)) return;
  etikettProdukter.splice(i, 1);
  try {
    await lagreEtikettProdukter();
    renderEtikettListe();
    fyllEtikettVelger();
  } catch (e) {
    alert('Kunne ikke slette: ' + e.message);
  }
}

// ── Utskrift ───────────────────────────────────────────────
function norskDato(d) {
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Uthever allergenene i ingredienslista, slik merkeforskriften krever
function uthevAllergener(tekst, allergener) {
  let ut = esc(tekst);
  const ord = {
    'Gluten': ['hvetemel', 'hvete', 'mel', 'bygg', 'rug', 'havre', 'spelt', 'gluten'],
    'Melk':   ['melk', 'smør', 'fløte', 'rømme', 'ost', 'kremfløte', 'smørkrem'],
    'Egg':    ['egg', 'eggeplomme', 'eggehvite'],
    'Nøtter': ['mandler', 'mandel', 'hasselnøtter', 'valnøtter', 'nøtter', 'pistasj'],
    'Peanøtter': ['peanøtter', 'peanøttsmør'],
    'Soya':   ['soya', 'soyalecitin'],
    'Sesamfrø': ['sesam', 'sesamfrø'],
    'Sulfitt': ['sulfitt'],
    'Sennep': ['sennep'],
    'Selleri': ['selleri'],
    'Fisk':   ['fisk'],
    'Skalldyr': ['skalldyr'],
    'Bløtdyr': ['bløtdyr'],
    'Lupin':  ['lupin']
  };
  const treff = [];
  (allergener || []).forEach(a => (ord[a] || []).forEach(o => treff.push(o)));
  // Lengste ord forst, slik at "hvetemel" ikke blir delt opp av "mel"
  treff.sort((a, b) => b.length - a.length).forEach(o => {
    ut = ut.replace(new RegExp(`(?<!<[^>]*)\\b(${o})\\b`, 'gi'), '<b class="ag">$1</b>');
  });
  return ut;
}

// Ikke lovpalagt, men anbefalt nar kjokkenet jevnlig handterer flere allergener -
// samme poeng som star i prosetekst pa julesiden, bare kortet ned til etikettformat.
const SPOR_AV_LINJE = 'Kan inneholde spor av nøtter, gluten, melk og egg.';

function byggEtikettHtml(p, bestFoer, liten) {
  const ingr = p.ingredienser
    ? `<div class="ingr">Ingredienser: ${uthevAllergener(p.ingredienser, p.allergener)}</div>` : '';
  const allergenLinje = (p.allergener || []).length
    ? `<div class="alrg">Inneholder: ${p.allergener.map(a => esc(a.toUpperCase())).join(', ')}</div>` : '';
  const mengde = p.mengde ? `<span class="mengde">${esc(p.mengde)}</span>` : '';
  const oppb = p.oppbevaring && !liten ? `<div class="oppb">${esc(p.oppbevaring)}</div>` : '';
  const spor = !liten ? `<div class="spor">${SPOR_AV_LINJE}</div>` : '';

  // Navn/adresse pa driftsansvarlig er lovpalagt (sporbarhet), men holdes bevisst
  // diskre - liten skrift, egen linje under en tynn strek, ikke et dominerende element.
  return `<div class="etikett">
    <div class="topprad">
      <div class="navn">${esc(p.navn)} ${mengde}</div>
      <img class="logo" src="/assets/kakefrue-logo.png" alt="">
    </div>
    <div class="rule"></div>
    ${ingr}
    ${allergenLinje}
    ${spor}
    <div class="best">Best før: ${bestFoer}</div>
    ${oppb}
    <div class="avs"><span class="avs-navn">${esc(ETIKETT_AVSENDER[0])}</span>${ETIKETT_AVSENDER.slice(1).map(esc).join('<br>')}</div>
  </div>`;
}

function skrivUtEtiketter() {
  const idx = $('etikProdukt').value;
  if (idx === '' || !etikettProdukter[idx]) { alert('Velg et produkt først.'); return; }

  const p = etikettProdukter[idx];
  const pakket = $('etikDato').value;
  if (!pakket) { alert('Velg pakkedato.'); return; }

  if (p.bekreftet === false && !confirm(
    `«${p.navn}» er fortsatt merket som utkast.\n\n` +
    'Ingredienslisten er ikke bekreftet av deg. Skrive ut likevel?'
  )) return;

  const antall = Math.min(Math.max(parseInt($('etikAntall').value) || 1, 1), 200);
  const liten = $('etikStr').value === 'liten';

  const d = new Date(pakket + 'T12:00:00');
  d.setDate(d.getDate() + (parseInt(p.dager) || 14));
  const bestFoer = norskDato(d);

  const en = byggEtikettHtml(p, bestFoer, liten);

  // Forhandsvisning i admin, sa hun ser hva som kommer ut for hun skriver ut
  $('etikForhaandsvisning').innerHTML = `
    <p style="font-size:0.85rem;opacity:0.6;margin-bottom:10px;">
      Slik blir etiketten – ${antall} stk, best før ${bestFoer}:
    </p>
    <div class="etikett-preview">
      <style>
        .etikett-preview .etikett {
          max-width:${liten ? '270px' : '350px'}; border:1.4px solid var(--gold);
          border-radius:10px;
          padding:${liten ? '13px 15px' : '17px 19px'};
          font-family:'Lato',Helvetica,Arial,sans-serif; background:#fff; color:var(--brown);
          display:flex; flex-direction:column; justify-content:flex-start;
        }
        .etikett-preview .topprad { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .etikett-preview .navn { font-family:'Playfair Display',serif; font-weight:700; font-size:${liten ? '14px' : '18px'}; margin-bottom:0; color:var(--brown); }
        .etikett-preview .mengde { font-weight:400; font-size:${liten ? '9px' : '11px'}; color:var(--gold-dark); opacity:0.85; }
        .etikett-preview .logo { width:${liten ? '30px' : '40px'}; height:${liten ? '30px' : '40px'}; flex-shrink:0; object-fit:contain; }
        .etikett-preview .rule { height:1px; background:var(--gold); opacity:0.5; margin:${liten ? '4px 0' : '5px 0'}; }
        .etikett-preview .ingr { font-size:${liten ? '7.5px' : '9px'}; line-height:1.4; margin-bottom:3px; }
        .etikett-preview .ingr b.ag { color:var(--gold-dark); }
        .etikett-preview .alrg { font-size:${liten ? '7.5px' : '9px'}; font-weight:700; color:var(--gold-dark); margin-bottom:3px; }
        .etikett-preview .spor { font-size:${liten ? '6.5px' : '7.8px'}; font-style:italic; opacity:0.6; margin-bottom:3px; }
        .etikett-preview .best { font-size:${liten ? '10px' : '13px'}; font-weight:700; margin-top:4px; color:var(--brown); }
        .etikett-preview .oppb { font-size:9px; opacity:0.65; margin-top:2px; }
        .etikett-preview .avs { font-size:${liten ? '6px' : '7px'}; color:var(--gold-dark); opacity:0.65; margin-top:5px;
          padding-top:4px; border-top:0.75px solid var(--gold); line-height:1.4; }
        .etikett-preview .avs-navn { font-weight:700; letter-spacing:0.04em; text-transform:uppercase;
          font-size:${liten ? '8px' : '10px'}; opacity:1; display:block; margin-bottom:1px; }
      </style>
      ${en}
    </div>`;

  const vindu = window.open('', '_blank');
  if (!vindu) { alert('Nettleseren blokkerte utskriftsvinduet. Tillat popup for kakefrue.no.'); return; }

  vindu.document.write(`<!DOCTYPE html><html lang="nb"><head><meta charset="UTF-8">
    <title>Etiketter – ${esc(p.navn)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Lato:wght@400;700&display=swap" rel="stylesheet">
    <style>
      @page { size: A4; margin: 8mm; }
      * { box-sizing: border-box; }
      body { margin:0; font-family: 'Lato', Helvetica, Arial, sans-serif; background:#fff; color:#3D2420; }
      .ark { display:grid; grid-template-columns: repeat(${liten ? 3 : 2}, 1fr); gap:2mm; }
      .etikett {
        border: 1.1px solid #C4956A;
        border-radius: ${liten ? '2.2mm' : '3mm'};
        padding: ${liten ? '3mm 3.5mm' : '4mm 5mm'};
        max-height: ${liten ? '38mm' : '54mm'};
        overflow: hidden;
        display: flex; flex-direction: column; justify-content: flex-start;
        page-break-inside: avoid;
      }
      .topprad { display:flex; align-items:center; justify-content:space-between; gap:2mm; }
      .navn { font-family:'Playfair Display',serif; font-weight:700; color:#3D2420; font-size:${liten ? '10pt' : '13pt'}; margin-bottom:0; }
      .mengde { font-weight:400; font-size:${liten ? '7pt' : '8.5pt'}; color:#7A5230; opacity:0.85; }
      .logo { width:${liten ? '8mm' : '11mm'}; height:${liten ? '8mm' : '11mm'}; flex-shrink:0; object-fit:contain; }
      .rule { height:0.6pt; background:#C4956A; opacity:0.55; margin:${liten ? '0.8mm 0' : '1.2mm 0'}; }
      .ingr { font-size:${liten ? '5.6pt' : '7pt'}; line-height:1.35; margin-bottom:${liten ? '0.6mm' : '1mm'}; }
      .ingr b.ag { color:#7A5230; }
      .alrg { font-size:${liten ? '5.6pt' : '7pt'}; font-weight:700; color:#7A5230; margin-bottom:${liten ? '0.6mm' : '1mm'}; }
      .spor { font-size:${liten ? '5pt' : '6.2pt'}; font-style:italic; color:#3D2420; opacity:0.6; margin-bottom:${liten ? '0.6mm' : '1mm'}; }
      .best { font-size:${liten ? '7.5pt' : '9.5pt'}; font-weight:700; color:#3D2420; margin-top:${liten ? '0.8mm' : '1.2mm'}; }
      .oppb { font-size:6.5pt; color:#3D2420; opacity:0.65; margin-top:0.8mm; }
      .avs { font-size:${liten ? '4.4pt' : '5.4pt'}; color:#7A5230; opacity:0.65; margin-top:${liten ? '0.8mm' : '1.2mm'};
        padding-top:${liten ? '0.8mm' : '1.2mm'}; border-top:0.5pt solid #C4956A; line-height:1.35; }
      .avs-navn { font-weight:700; letter-spacing:0.05em; text-transform:uppercase; display:block;
        font-size:${liten ? '5.6pt' : '7pt'}; opacity:1; margin-bottom:0.5mm; }
      @media screen {
        body { background:#eee; padding:14px; }
        .ark { background:#fff; padding:8mm; max-width:210mm; margin:0 auto; box-shadow:0 2px 14px rgba(0,0,0,0.15); }
      }
    </style></head><body>
    <div class="ark">${Array(antall).fill(en).join('')}</div>
    <script>window.onload = function(){ window.print(); };<\/script>
    </body></html>`);
  vindu.document.close();
}


// ============================================================
// Spesialbestillinger
// ============================================================
async function loadSpesial() {
  const el = $('spesialListe');
  try {
    const liste = await api('/api/admin/special-requests');
    const ubehandlet = liste.filter(r => !r.handled).length;
    const badge = $('badge-spesial');
    if (badge) {
      badge.textContent = ubehandlet;
      badge.style.display = ubehandlet ? 'inline-block' : 'none';
    }

    if (!liste.length) {
      el.innerHTML = `<div style="background:var(--white);border-radius:var(--radius);
        box-shadow:var(--shadow);padding:40px 28px;text-align:center;opacity:0.6;">
        Ingen spesialbestillinger ennå.</div>`;
      return;
    }

    el.innerHTML = '<div style="display:grid;gap:12px;">' + liste.map(r => {
      const dato = new Date(r.created_at).toLocaleString('nb-NO',
        { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      return `<div style="background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);
                  padding:20px 24px;${r.handled ? 'opacity:0.55;' : ''}">
        <div style="display:flex;gap:16px;align-items:flex-start;">
          <div style="flex:1;min-width:0;">
            <h4 style="margin:0 0 4px;font-size:1.02rem;">
              ${esc(r.customer_name)}
              ${r.handled ? '<span style="background:rgba(122,158,130,0.16);color:#4E7256;font-size:0.68rem;font-weight:700;padding:3px 9px;border-radius:100px;margin-left:6px;vertical-align:middle;">TATT KONTAKT</span>' : ''}
            </h4>
            <p style="font-size:0.82rem;opacity:0.55;margin:0 0 10px;">${dato}</p>
            <p style="font-size:0.9rem;margin:0 0 10px;">
              <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>
              ${r.email ? ` · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}
            </p>
            ${r.message ? `<pre style="font-size:0.85rem;line-height:1.6;white-space:pre-wrap;
              font-family:inherit;background:rgba(196,149,106,0.07);border-radius:8px;
              padding:12px 14px;margin:0;">${esc(r.message)}</pre>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0;">
            <button class="btn ${r.handled ? 'btn-outline' : 'btn-primary'} btn-sm"
                    onclick="settSpesialBehandlet(${r.id}, ${r.handled ? 'false' : 'true'})">
              ${r.handled ? 'Angre' : 'Tatt kontakt ✓'}
            </button>
            <button class="btn btn-outline btn-sm" onclick="slettSpesial(${r.id})"
                    style="border-color:rgba(200,0,0,0.25);color:#c00;">Slett</button>
          </div>
        </div>
      </div>`;
    }).join('') + '</div>';
  } catch (e) {
    el.innerHTML = `<div style="padding:24px;color:#c00;">Kunne ikke laste: ${esc(e.message)}</div>`;
  }
}

async function settSpesialBehandlet(id, verdi) {
  try {
    await api('/api/admin/special-requests/' + id, {
      method: 'PUT', body: JSON.stringify({ handled: verdi })
    });
    loadSpesial();
  } catch (e) { alert('Kunne ikke lagre: ' + e.message); }
}

async function slettSpesial(id) {
  if (!confirm('Slette denne forespørselen?')) return;
  try {
    await api('/api/admin/special-requests/' + id, { method: 'DELETE' });
    loadSpesial();
  } catch (e) { alert('Kunne ikke slette: ' + e.message); }
}

// ── Næringskalkulator ─────────────────────────────────────
// Ingrediensbiblioteket lagres i settings (samme generiske mønster som
// etikett_produkter/jul_produkter). Selve oppskrift-beregningen i et gitt
// øyeblikk lagres IKKE mellom besøk - bruk "Kopier som tekst" for å ta vare
// på et resultat. Standardverdiene under er vanlige, generelle næringstall
// (ikke fra en spesifikk kilde) - Cecilie bør justere til egen emballasje
// for en presis deklarasjon.
let naringIngredienser = [];
let naringRaderState = [];

const NARING_STANDARD_INGREDIENSER = [
  { navn: 'Hvetemel', kcal: 340, fett: 1, mettet: 0.2, karbo: 70, sukker: 0.3, protein: 10, salt: 0 },
  { navn: 'Sukker (hvitt)', kcal: 400, fett: 0, mettet: 0, karbo: 100, sukker: 100, protein: 0, salt: 0 },
  { navn: 'Smør', kcal: 720, fett: 80, mettet: 51, karbo: 0.5, sukker: 0.5, protein: 0.5, salt: 0.02 },
  { navn: 'Egg', kcal: 155, fett: 11, mettet: 3.3, karbo: 1.1, sukker: 1.1, protein: 13, salt: 0.3 },
  { navn: 'Helmelk', kcal: 61, fett: 3.3, mettet: 2.1, karbo: 4.7, sukker: 4.7, protein: 3.2, salt: 0.1 },
  { navn: 'Kremfløte (36%)', kcal: 340, fett: 36, mettet: 23, karbo: 2.7, sukker: 2.7, protein: 2.1, salt: 0.05 },
  { navn: 'Kremost naturell', kcal: 245, fett: 23, mettet: 15, karbo: 4, sukker: 3.5, protein: 5.9, salt: 0.7 },
  { navn: 'Melkesjokolade', kcal: 535, fett: 30, mettet: 18, karbo: 57, sukker: 56, protein: 7.6, salt: 0.2 },
  { navn: 'Mørk sjokolade', kcal: 546, fett: 31, mettet: 19, karbo: 61, sukker: 47, protein: 4.9, salt: 0.02 },
  { navn: 'Bakepulver', kcal: 53, fett: 0, mettet: 0, karbo: 28, sukker: 0, protein: 0, salt: 1.5 },
  { navn: 'Vaniljesukker', kcal: 390, fett: 0, mettet: 0, karbo: 98, sukker: 95, protein: 0, salt: 0 },
  { navn: 'Gulrot', kcal: 41, fett: 0.2, mettet: 0, karbo: 10, sukker: 4.7, protein: 0.9, salt: 0.07 },
  { navn: 'Valnøtter', kcal: 654, fett: 65, mettet: 6, karbo: 14, sukker: 2.6, protein: 15, salt: 0 },
  { navn: 'Marsipan', kcal: 435, fett: 18, mettet: 1.6, karbo: 63, sukker: 60, protein: 6.9, salt: 0.05 },
  { navn: 'Rømme (35%)', kcal: 335, fett: 35, mettet: 22, karbo: 3.5, sukker: 3.5, protein: 2.3, salt: 0.05 }
];

async function loadNaringskalkulator() {
  try {
    const s = await api('/api/admin/settings');
    naringIngredienser = s.naring_ingredienser ? JSON.parse(s.naring_ingredienser) : null;
    if (!naringIngredienser || !naringIngredienser.length) {
      naringIngredienser = NARING_STANDARD_INGREDIENSER.slice();
      await lagreNaringIngredienser();
    }
  } catch (e) {
    naringIngredienser = NARING_STANDARD_INGREDIENSER.slice();
  }
  renderIngrediensListe();
  if (!naringRaderState.length) leggTilNaringRad();
  beregnNaring();
}

async function lagreNaringIngredienser() {
  await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ naring_ingredienser: JSON.stringify(naringIngredienser) }) });
}

function renderIngrediensListe() {
  $('ingrediensListe').innerHTML = naringIngredienser.map((ing, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.06);font-size:0.85rem;">
      <div>
        <strong>${ing.navn}</strong>
        <div style="opacity:0.55;font-size:0.78rem;">${ing.kcal} kcal · ${ing.fett}g fett · ${ing.karbo}g karbo · ${ing.protein}g protein</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-outline btn-sm" style="padding:3px 9px;" onclick="visNyIngrediensSkjema(${i})">Rediger</button>
        <button class="photo-delete-btn" style="padding:3px 9px;" onclick="slettIngrediens(${i})">🗑</button>
      </div>
    </div>`).join('');
  renderNaringRader();
}

function visNyIngrediensSkjema(redigerIndex) {
  const redigering = typeof redigerIndex === 'number';
  const ing = redigering ? naringIngredienser[redigerIndex] : { navn: '', kcal: '', fett: '', mettet: '', karbo: '', sukker: '', protein: '', salt: '' };
  const felt = (label, key, verdi) => `
    <div class="form-group" style="margin-bottom:8px;">
      <label class="form-label" style="font-size:0.75rem;">${label}</label>
      <input class="form-input" id="ningF_${key}" type="${key === 'navn' ? 'text' : 'number'}" step="0.1" value="${verdi}">
    </div>`;
  $('ingrediensSkjema').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;">
      ${felt('Navn', 'navn', ing.navn)}
      ${felt('Kcal per 100g', 'kcal', ing.kcal)}
      ${felt('Fett (g)', 'fett', ing.fett)}
      ${felt('- hvorav mettet (g)', 'mettet', ing.mettet)}
      ${felt('Karbohydrat (g)', 'karbo', ing.karbo)}
      ${felt('- hvorav sukker (g)', 'sukker', ing.sukker)}
      ${felt('Protein (g)', 'protein', ing.protein)}
      ${felt('Salt (g)', 'salt', ing.salt)}
    </div>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="btn btn-primary btn-sm" onclick="lagreNyIngrediens(${redigering ? redigerIndex : 'null'})">Lagre</button>
      <button class="btn btn-outline btn-sm" onclick="$('ingrediensSkjema').classList.add('hidden')">Avbryt</button>
    </div>`;
  $('ingrediensSkjema').classList.remove('hidden');
}

async function lagreNyIngrediens(redigerIndex) {
  const les = key => parseFloat($('ningF_' + key).value) || 0;
  const navn = $('ningF_navn').value.trim();
  if (!navn) { alert('Skriv inn et navn'); return; }
  const nyIng = { navn, kcal: les('kcal'), fett: les('fett'), mettet: les('mettet'), karbo: les('karbo'), sukker: les('sukker'), protein: les('protein'), salt: les('salt') };
  if (redigerIndex !== null && redigerIndex !== undefined) {
    const gammelNavn = naringIngredienser[redigerIndex].navn;
    naringIngredienser[redigerIndex] = nyIng;
    naringRaderState.forEach(rad => { if (rad.ingrediensNavn === gammelNavn) rad.ingrediensNavn = navn; });
  } else {
    naringIngredienser.push(nyIng);
  }
  await lagreNaringIngredienser();
  $('ingrediensSkjema').classList.add('hidden');
  renderIngrediensListe();
  beregnNaring();
}

async function slettIngrediens(i) {
  if (!confirm('Slette ' + naringIngredienser[i].navn + ' fra biblioteket?')) return;
  naringIngredienser.splice(i, 1);
  await lagreNaringIngredienser();
  renderIngrediensListe();
  beregnNaring();
}

function leggTilNaringRad() {
  naringRaderState.push({ ingrediensNavn: naringIngredienser[0]?.navn || '', gram: '' });
  renderNaringRader();
}
function fjernNaringRad(i) {
  naringRaderState.splice(i, 1);
  renderNaringRader();
  beregnNaring();
}
function oppdaterNaringRad(i, felt, verdi) {
  naringRaderState[i][felt] = verdi;
  beregnNaring();
}
function renderNaringRader() {
  naringRaderState.forEach(rad => {
    if (!naringIngredienser.find(ing => ing.navn === rad.ingrediensNavn)) {
      rad.ingrediensNavn = naringIngredienser[0]?.navn || '';
    }
  });
  $('naringRader').innerHTML = naringRaderState.map((rad, i) => `
    <div style="display:grid;grid-template-columns:1fr 90px 28px;gap:8px;margin-bottom:8px;align-items:center;">
      <select class="form-input" onchange="oppdaterNaringRad(${i}, 'ingrediensNavn', this.value)">
        ${naringIngredienser.map(ing => `<option value="${ing.navn}" ${ing.navn === rad.ingrediensNavn ? 'selected' : ''}>${ing.navn}</option>`).join('')}
      </select>
      <input class="form-input" type="number" min="0" placeholder="gram" value="${rad.gram}" oninput="oppdaterNaringRad(${i}, 'gram', this.value)">
      <button class="photo-delete-btn" style="padding:6px;" onclick="fjernNaringRad(${i})">✕</button>
    </div>`).join('');
}

function naringTotals() {
  const totals = { vekt: 0, kcal: 0, fett: 0, mettet: 0, karbo: 0, sukker: 0, protein: 0, salt: 0 };
  naringRaderState.forEach(rad => {
    const ing = naringIngredienser.find(x => x.navn === rad.ingrediensNavn);
    const gram = parseFloat(rad.gram) || 0;
    if (!ing || !gram) return;
    const faktor = gram / 100;
    totals.vekt += gram;
    totals.kcal += ing.kcal * faktor;
    totals.fett += ing.fett * faktor;
    totals.mettet += ing.mettet * faktor;
    totals.karbo += ing.karbo * faktor;
    totals.sukker += ing.sukker * faktor;
    totals.protein += ing.protein * faktor;
    totals.salt += ing.salt * faktor;
  });
  return totals;
}

function beregnNaring() {
  const totals = naringTotals();
  // Hun veier emnene sine i stedet for a telle antall - sa per-stk regnes na direkte
  // ut fra oppgitt gram per emne (skalert fra per-100g), ikke fra total/antall.
  const gramPerStk = parseFloat($('naringGramPerStk')?.value) || 0;
  const rund = n => Math.round(n * 10) / 10;
  const kJ = kcal => Math.round(kcal * 4.184);

  if (!totals.vekt) {
    $('naringResultat').innerHTML = '<p style="opacity:0.5;font-size:0.85rem;">Legg til ingredienser med mengde for å se beregningen.</p>';
    return;
  }
  const per100 = f => totals[f] / totals.vekt * 100;
  const perStk = f => per100(f) * gramPerStk / 100;
  const rad = (label, felt, enhet) => `
    <tr>
      <td style="padding:5px 0;">${label}</td>
      <td style="text-align:right;padding:5px 0;">${rund(per100(felt))}${enhet}</td>
      ${gramPerStk ? `<td style="text-align:right;padding:5px 0;">${rund(perStk(felt))}${enhet}</td>` : ''}
    </tr>`;

  const antallEmner = gramPerStk ? Math.round(totals.vekt / gramPerStk * 10) / 10 : null;
  $('naringResultat').innerHTML = `
    <div style="background:rgba(201,168,132,0.08);border-radius:var(--radius-sm);padding:16px 18px;">
      <p style="font-size:0.82rem;opacity:0.7;margin-bottom:10px;">Total vekt: <strong>${rund(totals.vekt)} g</strong>${gramPerStk ? ` · gir ca. ${antallEmner} emner à ${gramPerStk} g` : ''}</p>
      <table style="width:100%;font-size:0.85rem;border-collapse:collapse;">
        <tr style="border-bottom:1px solid rgba(0,0,0,0.12);font-weight:700;">
          <td style="padding:5px 0;">Næringsinnhold</td>
          <td style="text-align:right;padding:5px 0;">per 100 g</td>
          ${gramPerStk ? `<td style="text-align:right;padding:5px 0;">per emne (${gramPerStk} g)</td>` : ''}
        </tr>
        <tr>
          <td style="padding:5px 0;">Energi</td>
          <td style="text-align:right;padding:5px 0;">${kJ(per100('kcal'))} kJ / ${rund(per100('kcal'))} kcal</td>
          ${gramPerStk ? `<td style="text-align:right;padding:5px 0;">${kJ(perStk('kcal'))} kJ / ${rund(perStk('kcal'))} kcal</td>` : ''}
        </tr>
        ${rad('Fett', 'fett', ' g')}
        ${rad('- hvorav mettede fettsyrer', 'mettet', ' g')}
        ${rad('Karbohydrater', 'karbo', ' g')}
        ${rad('- hvorav sukkerarter', 'sukker', ' g')}
        ${rad('Protein', 'protein', ' g')}
        ${rad('Salt', 'salt', ' g')}
      </table>
      ${!gramPerStk ? '<p style="font-size:0.78rem;opacity:0.55;margin-top:8px;">Fyll inn vekt per emne over for å også se næringsinnhold per stykke.</p>' : ''}
      <button class="btn btn-outline btn-sm" style="margin-top:14px;" onclick="kopierNaringstekst()">📋 Kopier som tekst</button>
      <span id="naringKopiStatus" style="font-size:0.8rem;margin-left:8px;"></span>
    </div>`;
}

function kopierNaringstekst() {
  const totals = naringTotals();
  if (!totals.vekt) return;
  const per100 = f => totals[f] / totals.vekt * 100;
  const rund = n => Math.round(n * 10) / 10;
  const kJ = kcal => Math.round(kcal * 4.184);
  const navn = $('naringOppskriftNavn').value.trim() || 'Produkt';
  const tekst = `${navn} – Næringsinnhold per 100 g:
Energi: ${kJ(per100('kcal'))} kJ / ${rund(per100('kcal'))} kcal
Fett: ${rund(per100('fett'))} g
  hvorav mettede fettsyrer: ${rund(per100('mettet'))} g
Karbohydrater: ${rund(per100('karbo'))} g
  hvorav sukkerarter: ${rund(per100('sukker'))} g
Protein: ${rund(per100('protein'))} g
Salt: ${rund(per100('salt'))} g`;
  navigator.clipboard.writeText(tekst).then(() => {
    $('naringKopiStatus').textContent = '✓ Kopiert';
    setTimeout(() => { $('naringKopiStatus').textContent = ''; }, 2000);
  });
}
