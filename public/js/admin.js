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
    case 'kurs': loadCourses(); loadCourseInterests(); break;
    case 'anbefalinger': loadReviews(); break;
    case 'priser': loadPricing(); break;
    case 'kunder': loadCustomers(); break;
    case 'jul': loadChristmasOrders(); break;
    case 'bilder': loadPhotos(); loadAboutImages(); break;
    case 'spesial': loadSpesial(); break;
    case 'etiketter': loadEtiketter(); break;
    case 'statistikk': loadStatistikk(); break;
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

function aapnePurring(o) {
  const varer = (o.products || []).map(p => `${p.name} x${p.qty}`).join(', ');
  const vare = (o.products || []).reduce((s2,p) => s2 + (p.price||0)*(p.qty||1), 0);
  const total = vare + (parseInt(o.delivery_cost) || 0);
  const bestilt = o.created_at ? new Date(o.created_at).toLocaleDateString('nb-NO',{day:'numeric',month:'long'}) : '';

  openModal(`
    <div class="modal-header">
      <h3>⚠️ Mangler betaling – ${o.full_name}</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div style="background:rgba(196,120,138,.12);border:1px solid rgba(155,58,82,.3);border-radius:8px;padding:12px 15px;margin-bottom:16px;font-size:0.85rem;line-height:1.65;">
        Bestilt <strong>${bestilt}</strong> · <strong>${total} kr</strong> · ${varer || '—'}<br>
        <span style="opacity:0.7;">${o.payment_claimed_at ? 'Kunden har trykket «Jeg har betalt», men du har ikke bekreftet.' : 'Kunden har ikke meldt om betaling.'}</span>
      </div>

      <div class="form-group" style="margin-bottom:6px;">
        <label class="form-label">Meldingen – rediger fritt</label>
        <textarea class="form-input" id="purreTekst" rows="10" style="line-height:1.65;"></textarea>
      </div>
      <p style="font-size:0.78rem;opacity:0.6;margin:0;">📞 ${o.phone}${o.email ? ' · ' + o.email : ' · ingen e-post oppgitt'}</p>
      <div id="purreStatus" style="font-size:0.85rem;margin-top:10px;"></div>
    </div>
    <div class="modal-footer" style="flex-wrap:wrap;gap:8px;">
      <button class="btn btn-outline" onclick="closeModal()">Lukk</button>
      <button class="btn btn-outline" onclick="kopierPurring()">📋 Kopier til SMS</button>
      ${o.email
        ? `<button class="btn btn-primary" id="purreSendBtn" onclick="sendPurring(${o.id}, '${o.email}', '${(o.full_name||'').replace(/'/g,"&apos;")}')">✉️ Send e-post</button>`
        : `<span style="font-size:0.8rem;opacity:0.6;align-self:center;">Ingen e-post – bruk SMS</span>`}
    </div>
  `);

  const fornavn = (o.full_name || '').split(' ')[0];
  document.getElementById('purreTekst').value =
`Hei ${fornavn}!

Jeg har ikke registrert betaling for julebestillingen din p\u00e5 ${total} kr.

En bestilling er f\u00f8rst gyldig n\u00e5r den er betalt, s\u00e5 den er dessverre ikke satt opp i produksjonen min enn\u00e5.

Vipps ${total} kr til 90 03 30 39, og merk med navnet ditt. Da ordner det seg.

Har du allerede betalt? Si fra, s\u00e5 sjekker jeg p\u00e5 nytt.

Med vennlig hilsen
Cecilie \u2013 Kakefrue
900 33 039`;
}

function kopierPurring() {
  const t = document.getElementById('purreTekst').value;
  const ok = () => { document.getElementById('purreStatus').innerHTML =
    '<span style="color:var(--sage);">\u2713 Kopiert \u2013 lim inn i meldingsappen</span>'; };
  navigator.clipboard.writeText(t).then(ok, () => { document.getElementById('purreTekst').select(); ok(); });
}

async function sendPurring(id, epost, navn) {
  const btn = document.getElementById('purreSendBtn');
  btn.disabled = true; btn.textContent = 'Sender...';
  try {
    const r = await api('/api/admin/send-email', {
      method: 'POST',
      body: JSON.stringify({
        to: epost, name: navn,
        subject: 'Manglende betaling – julebestillingen din',
        message: document.getElementById('purreTekst').value
      })
    });
    if (r.mailto_fallback) throw new Error('E-post ikke satt opp');
    document.getElementById('purreStatus').innerHTML =
      '<span style="color:var(--sage);">\u2713 Sendt til ' + epost + '</span>';
    btn.textContent = '\u2713 Sendt';
  } catch (e) {
    document.getElementById('purreStatus').innerHTML = '<span style="color:#C62828;">Feil: ' + e.message + '</span>';
    btn.disabled = false; btn.textContent = '\u2709\ufe0f Send e-post';
  }
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="form-group">
          <label class="form-label">${levering ? 'Leveringsdag' : 'Hentedag'}</label>
          <input class="form-input" id="hentNaar" value="${iMorgen}" oninput="byggHentetekst()">
        </div>
        <div class="form-group">
          <label class="form-label">Tidspunkt</label>
          <input class="form-input" id="hentTid" placeholder="${levering ? 'f.eks. ca. kl. 17' : 'f.eks. mellom 16 og 19'}" oninput="byggHentetekst()">
        </div>
      </div>
      ${levering
        ? `<div class="form-group">
             <label class="form-label">Leveringsadresse <span style="font-weight:300;opacity:.6;">(fra bestillingen)</span></label>
             <input class="form-input" id="hentSted" value="${(o.address||'').replace(/"/g,'&quot;')}" oninput="byggHentetekst()">
           </div>`
        : `<div class="form-group">
             <label class="form-label">Hentested</label>
             <input class="form-input" id="hentSted" value="${HENTEADRESSE}" oninput="byggHentetekst()">
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
  const sted = ($('hentSted')?.value || '').trim();
  const fornavn = (o.full_name || '').split(' ')[0];
  const naarDel = [naar, tid].filter(Boolean).join(' ') || '[fyll inn tidspunkt]';
  const holdbar = ($('hentHoldbar')?.value || '').trim();
  const holdbarLinje = holdbar ? `\n${holdbar}\n` : '';

  $('hentTekst').value = levering
? `Hei ${fornavn}!

Julebestillingen din er ferdig, og jeg kommer med den ${naarDel}.

Adresse: ${sted || '[adresse mangler]'}
${holdbarLinje}
Si fra hvis tidspunktet ikke passer, så finner vi noe annet.

Med vennlig hilsen
Cecilie – Kakefrue
900 33 039`
: `Hei ${fornavn}!

Julebestillingen din er ferdig og klar til henting.

Du kan hente den ${naarDel}.
Adresse: ${sted || HENTEADRESSE}

Bestillingen holdes ut hentedagen. Passer ikke tidspunktet, si fra før da, så finner vi en løsning.
${holdbarLinje}
Ser frem til å se deg!

Med vennlig hilsen
Cecilie – Kakefrue
900 33 039`;
}

async function settVarslet(id, varslet, via) {
  try {
    await api('/api/admin/christmas-orders/' + id, {
      method: 'PUT',
      body: JSON.stringify({ notified: varslet, via })
    });
    loadChristmasOrders();
    if (!varslet) closeModal();
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
        message: $('hentTekst').value
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
    const orders = await api('/api/admin/christmas-orders');
    if (!orders.length) {
      container.innerHTML = '<div style="text-align:center;padding:48px;opacity:0.4;">Ingen julebestillinger ennå</div>';
      return;
    }
    container.innerHTML = `
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
              ${o.paid_at
                ? `<span style="align-self:center;background:rgba(122,158,130,.2);color:#4A7A5A;border-radius:100px;padding:6px 13px;font-size:0.78rem;font-weight:700;">💰 Betalt</span>`
                : o.payment_claimed_at
                  ? `<button class="btn btn-primary btn-sm" style="background:#7A9E82;color:#fff;border-color:#7A9E82;" onclick="bekreftBetaling(${o.id})">💰 Bekreft betaling</button>`
                  : `<span style="align-self:center;font-size:0.78rem;opacity:0.5;">Ikke betalt</span>`}
              ${!o.paid_at
                ? `<button class="btn btn-outline btn-sm" style="color:#9B3A52;border-color:rgba(155,58,82,.45);" onclick='aapnePurring(${JSON.stringify(o).replace(/'/g, "&apos;")})'>⚠️ Mangler betaling</button>`
                : ''}
              <button class="btn btn-primary btn-sm" onclick='aapneHentemelding(${JSON.stringify(o).replace(/'/g, "&apos;")})'>${o.delivery === 'levering' ? '🚗 Varsle om levering' : '📦 Klar til henting'}</button>
              <button class="photo-delete-btn" style="padding:7px 12px;" title="Slett bestilling" onclick="slettJulebestilling(${o.id}, this)">🗑</button>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
            ${(o.products || []).map(p => `<span class="tag tag-sage">${p.name} × ${p.qty}${p.price ? ' · ' + (p.price * p.qty) + ' kr' : ''}</span>`).join('')}
          </div>
          <div style="font-size:0.85rem;opacity:0.6;display:flex;gap:16px;flex-wrap:wrap;">
            <span>${o.delivery === 'levering' ? `🚗 Levering: ${o.address || '—'}` : '🏠 Henting'}</span>
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
  } catch (e) { container.innerHTML = '<div style="padding:32px;opacity:0.5;">Kunne ikke laste bestillinger</div>'; }
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
  loadPageViews();

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
        <div class="form-group"><label class="form-label">Maks deltakere</label><input class="form-input" id="m-c-max" type="number" value="${c ? c.max_participants : 4}" style="max-width:100px;"></div>
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
    max_participants: parseInt($('m-c-max').value) || 4,
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
  try {
    await api('/api/admin/courses/' + id, { method: 'DELETE' });
    loadCourses();
  } catch (e) {
    alert('Kunne ikke slette kurset: ' + e.message);
  }
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

// ============================================================
// Etiketter – merking av ferdigpakkede produkter
// ============================================================
const ALLERGENER = [
  'Gluten', 'Skalldyr', 'Egg', 'Fisk', 'Peanøtter', 'Soya', 'Melk',
  'Nøtter', 'Selleri', 'Sennep', 'Sesamfrø', 'Sulfitt', 'Lupin', 'Bløtdyr'
];

// Avsender pa etiketten – lovpalagt: navn og adresse pa virksomheten
const ETIKETT_AVSENDER = [
  'Kakefrue · NIAX CONSULTING AS',
  'Storgata 157D, 3915 Porsgrunn'
];

let etikettProdukter = [];

// Gjor tekst trygg i HTML – navn og ingredienser skrives fritt inn
function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
          <label class="form-label">Nettovekt <span style="font-weight:300;opacity:0.6;">– valgfritt</span></label>
          <input class="form-input" id="epMengde" value="${esc(p.mengde || '')}" placeholder="f.eks. 250 g">
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
    ut = ut.replace(new RegExp(`(?<!<[^>]*)\\b(${o})\\b`, 'gi'), '<b>$1</b>');
  });
  return ut;
}

function byggEtikettHtml(p, bestFoer, liten) {
  const ingr = p.ingredienser
    ? `<div class="ingr">Ingredienser: ${uthevAllergener(p.ingredienser, p.allergener)}</div>` : '';
  const allergenLinje = (p.allergener || []).length
    ? `<div class="alrg">Inneholder: ${p.allergener.map(a => esc(a.toUpperCase())).join(', ')}</div>` : '';
  const mengde = p.mengde ? `<span class="mengde">${esc(p.mengde)}</span>` : '';
  const oppb = p.oppbevaring && !liten ? `<div class="oppb">${esc(p.oppbevaring)}</div>` : '';

  return `<div class="etikett">
    <div class="navn">${esc(p.navn)} ${mengde}</div>
    ${ingr}
    ${allergenLinje}
    <div class="best">Best før: ${bestFoer}</div>
    ${oppb}
    <div class="avs">${ETIKETT_AVSENDER.map(esc).join('<br>')}</div>
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
          max-width:${liten ? '270px' : '350px'}; border:1px dashed #bbb;
          padding:${liten ? '11px 13px' : '15px 17px'};
          font-family:Helvetica,Arial,sans-serif; background:#fff; color:#000;
          display:flex; flex-direction:column;
        }
        .etikett-preview .navn { font-weight:700; font-size:${liten ? '12px' : '15px'}; margin-bottom:5px; }
        .etikett-preview .mengde { font-weight:400; font-size:${liten ? '9px' : '11px'}; opacity:0.7; }
        .etikett-preview .ingr { font-size:${liten ? '7.5px' : '9px'}; line-height:1.4; margin-bottom:4px; }
        .etikett-preview .alrg { font-size:${liten ? '7.5px' : '9px'}; font-weight:700; margin-bottom:4px; }
        .etikett-preview .best { font-size:${liten ? '10px' : '12.5px'}; font-weight:700; margin-top:6px; }
        .etikett-preview .oppb { font-size:9px; margin-top:3px; }
        .etikett-preview .avs { font-size:${liten ? '6.5px' : '8px'}; opacity:0.75; margin-top:6px; line-height:1.35; }
      </style>
      ${en}
    </div>`;

  const vindu = window.open('', '_blank');
  if (!vindu) { alert('Nettleseren blokkerte utskriftsvinduet. Tillat popup for kakefrue.no.'); return; }

  vindu.document.write(`<!DOCTYPE html><html lang="nb"><head><meta charset="UTF-8">
    <title>Etiketter – ${esc(p.navn)}</title>
    <style>
      @page { size: A4; margin: 8mm; }
      * { box-sizing: border-box; }
      body { margin:0; font-family: Helvetica, Arial, sans-serif; background:#fff; color:#000; }
      .ark { display:grid; grid-template-columns: repeat(${liten ? 3 : 2}, 1fr); gap:0; }
      .etikett {
        border: 1px dashed #bbb;
        padding: ${liten ? '3mm 3.5mm' : '4mm 5mm'};
        height: ${liten ? '38mm' : '54mm'};
        overflow: hidden;
        display: flex; flex-direction: column;
        page-break-inside: avoid;
      }
      .navn { font-weight:700; font-size:${liten ? '9pt' : '11.5pt'}; margin-bottom:${liten ? '1mm' : '1.6mm'}; }
      .mengde { font-weight:400; font-size:${liten ? '7pt' : '8.5pt'}; opacity:0.7; }
      .ingr { font-size:${liten ? '5.6pt' : '7pt'}; line-height:1.35; margin-bottom:${liten ? '0.8mm' : '1.4mm'}; }
      .alrg { font-size:${liten ? '5.6pt' : '7pt'}; font-weight:700; margin-bottom:${liten ? '0.8mm' : '1.4mm'}; }
      .best { font-size:${liten ? '7.5pt' : '9.5pt'}; font-weight:700; margin-top:auto; }
      .oppb { font-size:7pt; margin-top:1mm; }
      .avs { font-size:${liten ? '5pt' : '6.2pt'}; opacity:0.75; margin-top:${liten ? '0.8mm' : '1.6mm'}; line-height:1.3; }
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
