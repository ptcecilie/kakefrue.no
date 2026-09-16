require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { pool, initDB } = require('./db');
const { createSumUpCheckout, getSumUpCheckoutStatus, handlePaymentSuccess } = require('./payments');
const { sendTastingConfirmation, sendCourseConfirmation, createTransporter } = require('./email');
const crypto = require('crypto');
const {
  vippsAktiv, opprettBetaling, hentBetaling, trekkBetaling,
  kansellerBetaling, refunderBetaling, vippsFeiltekst
} = require('./vipps');

const app = express();
app.use(express.json({ limit: '25mb' }));

// ── Page view tracking ─────────────────────────────────────
const TRACKED_PAGES = {
  '/': 'Forside',
  '/index.html': 'Forside',
  '/jul.html': 'Julebestillinger',
  '/book.html': 'Book din kake',
  '/meny.html': 'Meny',
  '/om-kakefrue.html': 'Om Kakefrue',
  '/kurs.html': 'Kurs',
  '/anbefalinger.html': 'Anbefalinger',
  '/provesmaking.html': 'Prøvesmaking',
  '/vilkar.html': 'Vilkår'
};
// Cecilies egne besok skal ikke telles med i statistikken.
// Kapselen settes ved innlogging i admin, eller ved aa besoke ?ikkespor=1
const ETT_AR = 365 * 24 * 60 * 60 * 1000;
function harIkkeSporKapsel(req) {
  return (req.headers.cookie || '').split(';').some(c => c.trim() === 'kf_ikkespor=1');
}
function settIkkeSpor(res) {
  res.setHeader('Set-Cookie',
    `kf_ikkespor=1; Max-Age=${ETT_AR / 1000}; Path=/; SameSite=Lax`);
}

app.use((req, res, next) => {
  // Egen lenke for aa slaa det av paa en ny enhet, f.eks. mobilen
  if (req.query.ikkespor === '1') settIkkeSpor(res);

  const page = TRACKED_PAGES[req.path];
  if (page && req.method === 'GET' && !harIkkeSporKapsel(req) && req.query.ikkespor !== '1') {
    const today = new Date().toISOString().slice(0, 10);
    pool.query(
      `INSERT INTO page_views (page, view_date, count) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE count = count + 1`,
      [page, today]
    ).catch(() => {});
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Admin Auth Middleware
// ============================================================
async function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (!password) return res.status(401).json({ error: 'Ingen passord oppgitt' });

  const [rows] = await pool.query(`SELECT v FROM settings WHERE k = 'admin_password'`);
  const stored = rows[0]?.v;
  if (!stored || password !== stored) return res.status(401).json({ error: 'Feil passord' });
  next();
}

// POST /api/admin/ikke-spor — kalles etter innlogging i admin
app.post('/api/admin/ikke-spor', requireAdmin, (req, res) => {
  settIkkeSpor(res);
  res.json({ ok: true });
});

// DELETE /api/admin/pageviews — nullstill statistikken og start pa nytt
app.delete('/api/admin/pageviews', requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM page_views`);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// ============================================================
// Public API
// ============================================================

// GET /api/jul-produkter
// Produktene som vises pa /jul.html. Cecilie administrerer disse selv fra
// admin -> Julebestillinger (legg til / rediger / slett), ikke hardkodet lenger.
app.get('/api/jul-produkter', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT v FROM settings WHERE k = 'jul_produkter'`);
    const produkter = rows[0]?.v ? JSON.parse(rows[0].v) : [];
    res.json(produkter);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

// ── Eventer ─────────────────────────────────────────────────
// Dagens dato i norsk tid som YYYY-MM-DD (sv-SE gir akkurat det formatet)
const osloIdag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
const eventBestillbar = e => !!e.henting && (!e.frist || Date.now() < Date.parse(e.frist)) && e.dato >= osloIdag();
function eventDatoTekst(e) {
  return new Date(e.dato + 'T12:00:00Z').toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Oslo' });
}
const eventTekst = e => `${e.tittel}, ${eventDatoTekst(e)}${e.fra ? ` kl. ${e.fra}–${e.til || ''}` : ''}${e.adresse ? ` (${e.adresse})` : ''}`;
const visEvent = e => ({
  id: e.id, tittel: e.tittel, dato: e.dato, fra: e.fra, til: e.til, sted: e.sted, adresse: e.adresse,
  beskrivelse: e.beskrivelse, vis_forside: !!e.vis_forside, henting: !!e.henting, frist: e.frist,
  bestillbar: eventBestillbar(e)
});

// GET /api/eventer – kommende eventer (i dag og framover)
app.get('/api/eventer', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM eventer WHERE dato >= ? ORDER BY dato, fra`, [osloIdag()]);
    res.json(rows.map(visEvent));
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

app.get('/api/admin/eventer', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM eventer ORDER BY dato DESC, fra`);
    res.json(rows.map(visEvent));
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

function eventFraSkjema(b) {
  const tittel = String(b.tittel || '').trim();
  if (!tittel) throw { status: 400, message: 'Skriv inn navn på eventet' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dato || '')) throw { status: 400, message: 'Velg dato' };
  const tid = t => (/^\d{2}:\d{2}$/.test(t || '') ? t : null);
  const frist = b.frist && !isNaN(Date.parse(b.frist)) ? b.frist : null;
  return [tittel, b.dato, tid(b.fra), tid(b.til), String(b.sted || '').trim() || null,
    String(b.adresse || '').trim() || null, String(b.beskrivelse || '').trim() || null,
    b.vis_forside ? 1 : 0, b.henting ? 1 : 0, frist];
}

app.post('/api/admin/eventer', requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query(
      `INSERT INTO eventer (tittel, dato, fra, til, sted, adresse, beskrivelse, vis_forside, henting, frist) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      eventFraSkjema(req.body));
    res.json({ ok: true, id: r.insertId });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.put('/api/admin/eventer/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE eventer SET tittel=?, dato=?, fra=?, til=?, sted=?, adresse=?, beskrivelse=?, vis_forside=?, henting=?, frist=? WHERE id=?`,
      [...eventFraSkjema(req.body), req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.delete('/api/admin/eventer/:id', requireAdmin, async (req, res) => {
  try {
    const [[{ antall }]] = await pool.query(`SELECT COUNT(*) AS antall FROM christmas_orders WHERE event_id = ?`, [req.params.id]);
    if (antall) return res.status(409).json({ error: `${antall} bestilling(er) skal hentes på dette eventet. Flytt eller slett dem først.` });
    await pool.query(`DELETE FROM eventer WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/allergener
// Allergeninformasjon skal vaere tilgjengelig FOR kunden kjoper, jf. merkeforskriften.
// Samme kilde som etikettene i admin, sa de to aldri kan sprike.
// Kun produkter Cecilie har bekreftet slippes ut – utkast skal ikke vises offentlig.
app.get('/api/allergener', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT v FROM settings WHERE k = 'etikett_produkter'`);
    const alle = rows[0]?.v ? JSON.parse(rows[0].v) : [];
    // Bare utkast holdes tilbake. Produkter uten feltet er skrevet inn
    // manuelt av Cecilie, og det regnes som bekreftet.
    res.json(alle
      .filter(p => p.bekreftet !== false)
      .map(p => ({
        navn: p.navn,
        ingredienser: p.ingredienser || '',
        allergener: p.allergener || [],
        oppbevaring: p.oppbevaring || ''
      })));
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

// GET /api/available-dates
app.get('/api/available-dates', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, date, max_capacity, current_bookings, allows_delivery, notes
       FROM available_dates
       WHERE date >= CURDATE() AND current_bookings < max_capacity
       ORDER BY date ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/customers — Step 1 of booking
app.post('/api/customers', async (req, res) => {
  const { full_name, phone, email } = req.body;
  if (!full_name || !phone) return res.status(400).json({ error: 'Navn og telefon er påkrevd' });

  try {
    const [result] = await pool.query(
      `INSERT INTO customers (full_name, phone, email) VALUES (?, ?, ?)`,
      [full_name.trim(), phone.trim(), email?.trim() || null]
    );
    const customerId = result.insertId;

    // Create abandoned booking record
    await pool.query(
      `INSERT INTO abandoned_bookings (customer_id, last_step) VALUES (?, 1)`,
      [customerId]
    );

    // Notify Cecilie about new incomplete booking
    try {
      const transporter = createTransporter();
      await transporter.sendMail({
        from: `"Kakefrue" <${process.env.SMTP_FROM || 'cecilie@kakefrue.no'}>`,
        to: 'cecilie@kakefrue.no',
        subject: `⏳ Ny ufullstendig bestilling – ${full_name.trim()}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#FAF6F0;padding:32px;border-radius:12px;">
            <h2 style="color:#3D2B5A;">Ny ufullstendig bestilling</h2>
            <p><strong>${full_name.trim()}</strong> har startet en bestilling men ikke fullført den ennå.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:6px 0;opacity:0.6;width:120px;">Navn</td><td><strong>${full_name.trim()}</strong></td></tr>
              <tr><td style="padding:6px 0;opacity:0.6;">Telefon</td><td>${phone.trim()}</td></tr>
              ${email ? `<tr><td style="padding:6px 0;opacity:0.6;">E-post</td><td>${email.trim()}</td></tr>` : ''}
            </table>
            <p><a href="https://www.kakefrue.no/admin.html" style="color:#8B72BE;">Gå til adminpanelet →</a></p>
            <p style="font-size:0.8rem;opacity:0.4;margin-top:24px;">– Kakefrue varslingssystem</p>
          </div>
        `
      });
    } catch (mailErr) { console.log('[Abandoned notify] Email not sent:', mailErr.message); }

    res.json({ customer_id: customerId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/bookings
app.post('/api/bookings', async (req, res) => {
  const {
    customer_id, booking_date, occasion, occasion_custom, guest_count,
    delivery_type, delivery_address, allergens, design_level,
    items, deposit_amount, total_amount
  } = req.body;

  if (!customer_id || !booking_date) {
    return res.status(400).json({ error: 'Mangler påkrevde felter' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO bookings
        (customer_id, booking_date, occasion, occasion_custom, guest_count,
         delivery_type, delivery_address, allergens, design_level,
         deposit_amount, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customer_id, booking_date, occasion, occasion_custom || null,
        guest_count || null, delivery_type || 'henting',
        delivery_address || null,
        allergens ? JSON.stringify(allergens) : null,
        design_level || null, deposit_amount || null, total_amount || null
      ]
    );
    const bookingId = result.insertId;

    // Insert booking items
    if (items && items.length > 0) {
      for (const item of items) {
        await conn.query(
          `INSERT INTO booking_items (booking_id, category, item_details) VALUES (?, ?, ?)`,
          [bookingId, item.category, JSON.stringify(item.details)]
        );
      }
    }

    // Update date capacity
    await conn.query(
      `UPDATE available_dates SET current_bookings = current_bookings + 1 WHERE date = ?`,
      [booking_date]
    );

    // Update abandoned booking
    await conn.query(
      `UPDATE abandoned_bookings SET last_step = 8 WHERE customer_id = ?`,
      [customer_id]
    );

    await conn.commit();

    // Notify Cecilie about new booking
    try {
      const [custRows] = await pool.query(`SELECT * FROM customers WHERE id = ?`, [customer_id]);
      const cust = custRows[0] || {};
      const transporter = createTransporter();
      await transporter.sendMail({
        from: `"Kakefrue" <${process.env.SMTP_FROM || 'cecilie@kakefrue.no'}>`,
        to: 'cecilie@kakefrue.no',
        subject: `🎂 Ny bestilling #${bookingId} – ${cust.full_name || ''}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#FAF6F0;padding:32px;border-radius:12px;">
            <h2 style="color:#3D2B5A;">Ny bestilling mottatt!</h2>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:6px 0;opacity:0.6;width:140px;">Bestillingsnr</td><td><strong>#${bookingId}</strong></td></tr>
              <tr><td style="padding:6px 0;opacity:0.6;">Kunde</td><td><strong>${cust.full_name || ''}</strong></td></tr>
              <tr><td style="padding:6px 0;opacity:0.6;">Telefon</td><td>${cust.phone || ''}</td></tr>
              ${cust.email ? `<tr><td style="padding:6px 0;opacity:0.6;">E-post</td><td>${cust.email}</td></tr>` : ''}
              <tr><td style="padding:6px 0;opacity:0.6;">Dato</td><td>${booking_date}</td></tr>
              <tr><td style="padding:6px 0;opacity:0.6;">Anledning</td><td>${occasion || '—'}</td></tr>
              <tr><td style="padding:6px 0;opacity:0.6;">Design</td><td>${design_level || '—'}</td></tr>
            </table>
            <p><a href="https://www.kakefrue.no/admin.html" style="color:#8B72BE;">Se bestillingen i adminpanelet →</a></p>
            <p style="font-size:0.8rem;opacity:0.4;margin-top:24px;">– Kakefrue varslingssystem</p>
          </div>
        `
      });
    } catch (mailErr) { console.log('[Booking notify] Email not sent:', mailErr.message); }

    res.json({ booking_id: bookingId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  } finally {
    conn.release();
  }
});

// GET /api/courses — include interest count per course
app.get('/api/courses', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*, COUNT(ci.id) as interest_count
       FROM courses c
       LEFT JOIN course_interests ci ON ci.course_id = c.id
       WHERE c.active = TRUE AND (c.date IS NULL OR c.date >= CURDATE())
       GROUP BY c.id
       ORDER BY c.date ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/course-interests
app.post('/api/course-interests', async (req, res) => {
  const { course_id, full_name, phone } = req.body;
  if (!course_id || !full_name || !phone) return res.status(400).json({ error: 'Navn og telefon er påkrevd' });
  try {
    await pool.query(
      `INSERT INTO course_interests (course_id, full_name, phone) VALUES (?, ?, ?)`,
      [course_id, full_name.trim(), phone.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/admin/course-interests
app.get('/api/admin/course-interests', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ci.*, c.title as course_title
      FROM course_interests ci
      JOIN courses c ON ci.course_id = c.id
      ORDER BY c.id ASC, ci.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// DELETE /api/admin/course-interests/:id
app.delete('/api/admin/course-interests/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM course_interests WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/course-registrations
app.post('/api/course-registrations', async (req, res) => {
  const { course_id, full_name, phone, email } = req.body;
  if (!course_id || !full_name || !phone || !email) {
    return res.status(400).json({ error: 'Alle felter er påkrevd' });
  }

  try {
    const [courseRows] = await pool.query(`SELECT * FROM courses WHERE id = ?`, [course_id]);
    if (!courseRows.length) return res.status(404).json({ error: 'Kurs ikke funnet' });
    const course = courseRows[0];

    if (course.current_participants >= course.max_participants) {
      return res.status(400).json({ error: 'Kurset er fullt' });
    }

    const [result] = await pool.query(
      `INSERT INTO course_registrations (course_id, full_name, phone, email) VALUES (?, ?, ?, ?)`,
      [course_id, full_name.trim(), phone.trim(), email.trim()]
    );

    await pool.query(
      `UPDATE courses SET current_participants = current_participants + 1 WHERE id = ?`,
      [course_id]
    );

    try { await sendCourseConfirmation(course, { full_name, email }); } catch (e) {}

    res.json({ registration_id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/tastings
app.post('/api/tastings', async (req, res) => {
  const { full_name, phone, email, preferred_date, choice_1, choice_2, choice_3 } = req.body;
  if (!full_name || !phone) return res.status(400).json({ error: 'Navn og telefon er påkrevd' });

  try {
    const [result] = await pool.query(
      `INSERT INTO tastings (full_name, phone, email, preferred_date, choice_1, choice_2, choice_3) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [full_name.trim(), phone.trim(), email?.trim() || null, preferred_date || null, choice_1 || null, choice_2 || null, choice_3 || null]
    );

    if (email) {
      try { await sendTastingConfirmation({ full_name, email, preferred_date, choice_1, choice_2, choice_3 }); } catch (e) {}
    }

    res.json({ tasting_id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// ── Julebestilling: priser regnes ut her, ikke i nettleseren ──
// Med integrert Vipps er det dette beløpet kunden faktisk belastes,
// så en endret side skal ikke kunne sette sin egen pris.
const LEVERINGSPRISER = [150, 250];
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function prisBestilling(products, delivery, delivery_cost) {
  const [rows] = await pool.query(`SELECT v FROM settings WHERE k = 'jul_produkter'`);
  const katalog = rows[0]?.v ? JSON.parse(rows[0].v) : [];
  const linjer = [];
  for (const valgt of products) {
    const p = katalog.find(x => x.k === valgt.key);
    const qty = parseInt(valgt.qty, 10);
    if (!p || !(qty > 0) || qty > 50) throw { status: 400, message: 'Et produkt i handlekurven finnes ikke lenger. Last siden på nytt.' };
    if (delivery === 'marked' && (p.ikkeMarked || p.k === 'kransekake')) {
      throw { status: 400, message: `${p.n} kan ikke hentes på julemarkedet. Den bestilles til henting eller levering før jul.` };
    }
    // Eldre sider sender ikke gf, bare «(glutenfri)» i navnet
    const gf = !!p.gfEkstra && (valgt.gf === true || /glutenfri/i.test(valgt.name || ''));
    linjer.push({ key: p.k, name: p.n + (gf ? ' (glutenfri)' : ''), unit: p.unit, price: p.pris + (gf ? p.gfEkstra : 0), qty, gf });
  }
  const frakt = delivery === 'levering' && LEVERINGSPRISER.includes(parseInt(delivery_cost, 10)) ? parseInt(delivery_cost, 10) : 0;
  const total = linjer.reduce((s, l) => s + l.price * l.qty, 0) + frakt;
  return { linjer, frakt, total };
}

const nettstedUrl = () => (process.env.PUBLIC_URL || 'https://kakefrue.no').replace(/\/$/, '');

async function startVippsBetaling(o, total) {
  const reference = `kfjul-${o.id}-${crypto.randomBytes(6).toString('hex')}`;
  const svar = await opprettBetaling({
    reference,
    belopKr: total,
    beskrivelse: `Julebestilling #${o.id} – Kakefrue`,
    returnUrl: `${nettstedUrl()}/jul.html?betaling=${reference}`,
    telefon: o.phone
  });
  await pool.query(`UPDATE christmas_orders SET vipps_reference = ?, vipps_state = 'CREATED' WHERE id = ?`, [reference, o.id]);
  return svar.redirectUrl;
}

// Henter status fra Vipps og oppdaterer bestillingen. Første gang betalingen
// er godkjent, markeres den som betalt og e-postene sendes.
async function synkVipps(o) {
  const b = await hentBetaling(o.vipps_reference);
  let trukket = (b.aggregate?.capturedAmount?.value || 0) > 0;
  const refundert = (b.aggregate?.refundedAmount?.value || 0) > 0;
  // Cecilie vil ha pengene med en gang kunden har godkjent, ikke ved levering
  if (b.state === 'AUTHORIZED' && !trukket && !refundert && !o.vipps_refunded_at &&
      !((b.aggregate?.cancelledAmount?.value || 0) > 0)) {
    try {
      await trekkBetaling(o.vipps_reference, b.amount.value);
      trukket = true;
    } catch (e) {
      // Blir stående som reservert; admin viser «Trekk beløpet»
      console.log('[Vipps] Automatisk trekk feilet:', vippsFeiltekst(e));
    }
  }
  await pool.query(
    `UPDATE christmas_orders SET vipps_state = ?,
       vipps_captured_at = IF(? AND vipps_captured_at IS NULL, NOW(), vipps_captured_at),
       vipps_refunded_at = IF(? AND vipps_refunded_at IS NULL, NOW(), vipps_refunded_at)
     WHERE id = ?`,
    [b.state, trukket, refundert, o.id]
  );
  // En refundert bestilling skal ikke bli «betalt» igjen – Vipps viser den fortsatt som AUTHORIZED
  if (b.state === 'AUTHORIZED' && !o.paid_at && !o.vipps_refunded_at && !refundert) {
    const [r] = await pool.query(`UPDATE christmas_orders SET paid_at = NOW(), payment_claimed_at = NOW() WHERE id = ? AND paid_at IS NULL`, [o.id]);
    if (r.affectedRows) await sendVippsEposter(o).catch(e => console.log('[Vipps e-post]', e.message));
  }
  return b.state;
}

async function sendVippsEposter(o) {
  const products = typeof o.products === 'string' ? JSON.parse(o.products) : (o.products || []);
  const total = o.total_kr ?? products.reduce((s, p) => s + p.price * p.qty, 0) + (o.delivery_cost || 0);
  const liste = products.map(p => `<li>${escHtml(p.name)} × ${p.qty} — ${p.price * p.qty} kr</li>`).join('');
  const levering = o.delivery === 'levering' ? 'Leveres til ' + escHtml(o.address || '—')
    : o.delivery === 'marked' ? 'Hentes på ' + escHtml(o.address || 'julemarkedet')
    : 'Hentes i Porsgrunn';
  const transporter = createTransporter();
  const fra = `"Kakefrue" <${process.env.SMTP_FROM || 'cecilie@kakefrue.no'}>`;

  try {
    await transporter.sendMail({
      from: fra, to: 'cecilie@kakefrue.no',
      subject: `🎄 Ny julebestilling betalt med Vipps: ${o.full_name} – ${total} kr`,
      html: internVarselJulHtml(o, total, liste, levering)
    });
  } catch (e) { console.log('[Vipps varsel til Cecilie]', e.message); }

  if (o.email) {
    try {
      const produktlinjer = products.map(p => `${p.name} × ${p.qty} — ${p.price * p.qty} kr`).join('\n');
      await transporter.sendMail({
        from: fra, to: o.email,
        subject: '🎄 Bestillingsbekreftelse fra Kakefrue',
        html: julEpostHtml(o.full_name, bestillingsbekreftelseTekst(o, total, produktlinjer, o.delivery))
      });
    } catch (e) { console.log('[Vipps bekreftelse til kunde]', e.message); }
  }
}

// POST /api/christmas-orders
app.post('/api/christmas-orders', async (req, res) => {
  const { full_name, phone, email, delivery, address, products, note, delivery_cost, event_id } = req.body;
  // Bestillingsfrist 2. desember kl. 00:00 norsk tid – også om noen har siden åpen fra før
  if (Date.now() >= Date.parse('2026-12-01T23:00:00Z')) {
    return res.status(403).json({ error: 'Bestillingsfristen er ute. Har du et spesielt ønske, ring 900 33 039.' });
  }
  if (!full_name || !phone) return res.status(400).json({ error: 'Navn og telefon er påkrevd' });
  if (!Array.isArray(products) || !products.length) return res.status(400).json({ error: 'Velg minst ett produkt' });
  try {
    // Henting på julemarked: markedet må finnes, ta imot henting og ikke ha passert fristen
    let hentested = null, eventId = null;
    if (delivery === 'marked') {
      const [[e]] = await pool.query(`SELECT * FROM eventer WHERE id = ?`, [parseInt(event_id, 10) || 0]);
      if (!e || !e.henting) return res.status(400).json({ error: 'Velg hvilket julemarked du vil hente på.' });
      if (!eventBestillbar(e)) {
        return res.status(403).json({ error: `Fristen for å bestille til ${e.tittel} er ute. Velg et annet marked, henting eller levering.` });
      }
      hentested = eventTekst(e);
      eventId = e.id;
    }
    const { linjer, frakt, total } = await prisBestilling(products, delivery, delivery_cost);
    const leveringsmate = ['levering', 'marked'].includes(delivery) ? delivery : 'henting';
    const [result] = await pool.query(
      `INSERT INTO christmas_orders (full_name, phone, email, delivery, address, products, note, delivery_cost, total_kr, event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [full_name.trim(), phone.trim(), email?.trim() || null, leveringsmate,
       leveringsmate === 'marked' ? hentested : (leveringsmate === 'levering' ? address?.trim() || null : null),
       JSON.stringify(linjer), note?.trim() || null, frakt, total, eventId]
    );
    const o = { id: result.insertId, phone: phone.trim() };

    // Kun Vipps for bedrift. Betaling til privat nummer skal ikke tilbys lenger.
    try {
      if (!vippsAktiv()) throw new Error('Vipps-nøkler mangler i Coolify');
      const vippsUrl = await startVippsBetaling(o, total);
      return res.json({ ok: true, id: o.id, total, vippsUrl });
    } catch (err) {
      console.error('[Vipps] Kunne ikke starte betaling:', vippsFeiltekst(err));
      // Ingen halvferdig bestilling i admin når kunden ikke fikk betalt
      await pool.query(`DELETE FROM christmas_orders WHERE id = ?`, [o.id]);
      return res.status(503).json({ error: 'Vipps-betalingen kunne ikke startes akkurat nå. Prøv igjen om litt, eller ring 900 33 039.' });
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/christmas-orders/vipps/:ref – kunden er tilbake fra Vipps
app.get('/api/christmas-orders/vipps/:ref', async (req, res) => {
  try {
    const [[o]] = await pool.query(`SELECT * FROM christmas_orders WHERE vipps_reference = ?`, [req.params.ref]);
    if (!o) return res.status(404).json({ error: 'Fant ikke betalingen' });
    const state = await synkVipps(o);
    res.json({ state, id: o.id, total: o.total_kr, epost: o.email || null, fornavn: o.full_name.split(' ')[0] });
  } catch (err) {
    console.error('[Vipps] Statussjekk feilet:', vippsFeiltekst(err));
    res.status(502).json({ error: 'Fikk ikke svar fra Vipps' });
  }
});

// POST /api/christmas-orders/vipps/:ref/ny – kunden avbrøt og vil prøve igjen
app.post('/api/christmas-orders/vipps/:ref/ny', async (req, res) => {
  try {
    const [[o]] = await pool.query(`SELECT * FROM christmas_orders WHERE vipps_reference = ?`, [req.params.ref]);
    if (!o) return res.status(404).json({ error: 'Fant ikke bestillingen' });
    const state = await synkVipps(o);
    if (state === 'AUTHORIZED') return res.json({ state });
    if (state === 'CREATED') await kansellerBetaling(o.vipps_reference).catch(() => {});
    res.json({ vippsUrl: await startVippsBetaling(o, o.total_kr) });
  } catch (err) {
    console.error('[Vipps] Ny betaling feilet:', vippsFeiltekst(err));
    res.status(502).json({ error: 'Fikk ikke startet Vipps' });
  }
});

// Trekker det reserverte beløpet. Kalles når Cecilie varsler om henting/levering.
async function trekkVipps(o) {
  if (!o.vipps_reference || o.vipps_captured_at) return false;
  const state = await synkVipps(o);
  if (state !== 'AUTHORIZED') return false;
  const [[fersk]] = await pool.query(`SELECT vipps_captured_at FROM christmas_orders WHERE id = ?`, [o.id]);
  if (fersk.vipps_captured_at) return false;
  await trekkBetaling(o.vipps_reference, o.total_kr * 100);
  await pool.query(`UPDATE christmas_orders SET vipps_captured_at = NOW() WHERE id = ?`, [o.id]);
  return true;
}

// POST /api/admin/christmas-orders/:id/vipps-trekk
app.post('/api/admin/christmas-orders/:id/vipps-trekk', requireAdmin, async (req, res) => {
  try {
    const [[o]] = await pool.query(`SELECT * FROM christmas_orders WHERE id = ?`, [req.params.id]);
    if (!o?.vipps_reference) return res.status(404).json({ error: 'Bestillingen er ikke betalt med Vipps' });
    const trukket = await trekkVipps(o);
    res.json({ ok: true, trukket });
  } catch (err) {
    res.status(502).json({ error: 'Vipps: ' + vippsFeiltekst(err) });
  }
});

// POST /api/admin/christmas-orders/:id/vipps-refunder – hele beløpet tilbake
app.post('/api/admin/christmas-orders/:id/vipps-refunder', requireAdmin, async (req, res) => {
  try {
    const [[o]] = await pool.query(`SELECT * FROM christmas_orders WHERE id = ?`, [req.params.id]);
    if (!o?.vipps_reference) return res.status(404).json({ error: 'Bestillingen er ikke betalt med Vipps' });
    if (o.vipps_refunded_at) return res.json({ ok: true });
    if (o.vipps_captured_at) {
      await refunderBetaling(o.vipps_reference, o.total_kr * 100);
    } else {
      await kansellerBetaling(o.vipps_reference);
    }
    await pool.query(`UPDATE christmas_orders SET vipps_refunded_at = NOW(), paid_at = NULL WHERE id = ?`, [o.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: 'Vipps: ' + vippsFeiltekst(err) });
  }
});

// POST /api/christmas-orders/:id/betalt — kunden bekrefter at Vipps er betalt.
// Foerst her gaar bekreftelsene ut, til Cecilie og til kunden.
app.post('/api/christmas-orders/:id/betalt', async (req, res) => {
  try {
    const [[o]] = await pool.query(`SELECT * FROM christmas_orders WHERE id = ?`, [req.params.id]);
    if (!o) return res.status(404).json({ error: 'Fant ikke bestillingen' });
    if (o.payment_claimed_at) return res.json({ ok: true, alt_meldt: true });

    await pool.query(`UPDATE christmas_orders SET payment_claimed_at = NOW() WHERE id = ?`, [req.params.id]);

    const products = typeof o.products === 'string' ? JSON.parse(o.products) : (o.products || []);
    const full_name = o.full_name;
    const phone = o.phone;
    const email = o.email;
    const delivery = o.delivery;
    const address = o.address;
    const note = o.note;
    const delivery_cost = o.delivery_cost;
    const transporter = createTransporter();
    const productList = products.map(p => `<li>${p.name} × ${p.qty} — ${p.price * p.qty} kr</li>`).join('');
    const frakt = parseInt(delivery_cost) || 0;
    const varesum = products.reduce((s, p) => s + (p.price || 0) * (p.qty || 1), 0);
    const total = varesum + frakt;
    // Notify Cecilie
    try {
      await transporter.sendMail({
        from: `"Kakefrue" <${process.env.SMTP_FROM || 'cecilie@kakefrue.no'}>`,
        to: 'cecilie@kakefrue.no',
        subject: `💰 SJEKK VIPPS: ${full_name.trim()} sier hun har betalt ${total} kr`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#FAF6F0;padding:32px;border-radius:12px;">
            <h2 style="color:#8B1A1A;">🎄 Ny julebestilling!</h2>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:6px 0;opacity:0.6;width:140px;">Navn</td><td><strong>${full_name.trim()}</strong></td></tr>
              <tr><td style="padding:6px 0;opacity:0.6;">Telefon</td><td>${phone.trim()}</td></tr>
              ${email ? `<tr><td style="padding:6px 0;opacity:0.6;">E-post</td><td>${email.trim()}</td></tr>` : ''}
              <tr><td style="padding:6px 0;opacity:0.6;">Levering</td><td>${delivery === 'levering' ? 'Levering til: ' + (address || '—') : 'Henting i Porsgrunn'}</td></tr>
              <tr><td style="padding:6px 0;opacity:0.6;">Totalt</td><td><strong>${total} kr</strong> (Vipps 90033039)</td></tr>
            </table>
            <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;">
              <strong>Bestilte produkter:</strong>
              <ul style="margin:10px 0 0;padding-left:20px;">${productList}</ul>
            </div>
            ${note ? `<p><strong>Kommentar:</strong> ${note}</p>` : ''}
            <p><a href="https://www.kakefrue.no/admin.html" style="color:#8B1A1A;">Se i adminpanelet →</a></p>
          </div>
        `
      });
    } catch (mailErr) { console.log('[Christmas notify] Email not sent:', mailErr.message); }

    // Send confirmation to customer
    res.json({ ok: true });
  } catch (err) {
    console.error('Betalingsmelding feilet:', err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/admin/christmas-orders/:id/bekreft-betaling
// Cecilie har sett pengene i Vipps. Foerst her faar kunden sin bekreftelse.
app.post('/api/admin/christmas-orders/:id/bekreft-betaling', requireAdmin, async (req, res) => {
  try {
    const [[o]] = await pool.query(`SELECT * FROM christmas_orders WHERE id = ?`, [req.params.id]);
    if (!o) return res.status(404).json({ error: 'Fant ikke bestillingen' });
    if (o.paid_at) return res.json({ ok: true, alt_bekreftet: true });

    await pool.query(`UPDATE christmas_orders SET paid_at = NOW() WHERE id = ?`, [req.params.id]);

    const products = typeof o.products === 'string' ? JSON.parse(o.products) : (o.products || []);
    const full_name = o.full_name;
    const phone = o.phone;
    const email = o.email;
    const delivery = o.delivery;
    const address = o.address;
    const note = o.note;
    const delivery_cost = o.delivery_cost;
    const transporter = createTransporter();
    const frakt = parseInt(delivery_cost) || 0;
    const varesum = products.reduce((s, p) => s + (p.price || 0) * (p.qty || 1), 0);
    const total = varesum + frakt;
    if (email) {
      try {
        const produktlinjer = products.map(p => `${p.name} × ${p.qty} — ${p.price * p.qty} kr`).join('\n');
        const oForTekst = { full_name, address };
        await transporter.sendMail({
          from: `"Kakefrue" <${process.env.SMTP_FROM || 'cecilie@kakefrue.no'}>`,
          to: email.trim(),
          subject: `🎄 Bestillingsbekreftelse fra Kakefrue`,
          html: julEpostHtml(full_name, bestillingsbekreftelseTekst(oForTekst, total, produktlinjer, delivery))
        });
      } catch (mailErr) { console.log('[Christmas customer email] Not sent:', mailErr.message); }
    }
    res.json({ ok: true, sendt_til: email || null });
  } catch (err) {
    console.error('Bekreftelse feilet:', err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/admin/christmas-orders
app.get('/api/admin/christmas-orders', requireAdmin, async (req, res) => {
  try {
    let [rows] = await pool.query(`SELECT * FROM christmas_orders ORDER BY created_at DESC`);
    // Kunder som lukket nettleseren i Vipps kom aldri tilbake til julesiden.
    // Sjekk de uavklarte betalingene her, så admin alltid viser riktig status.
    const uavklart = rows.filter(r => r.vipps_reference && !r.paid_at && !r.vipps_refunded_at &&
      ['CREATED', 'AUTHORIZED'].includes(r.vipps_state || 'CREATED'));
    if (uavklart.length && vippsAktiv()) {
      await Promise.all(uavklart.map(r => synkVipps(r).catch(e => console.log('[Vipps synk]', vippsFeiltekst(e)))));
      [rows] = await pool.query(`SELECT * FROM christmas_orders ORDER BY created_at DESC`);
    }
    res.json(rows.map(r => ({ ...r, products: typeof r.products === 'string' ? JSON.parse(r.products) : r.products })));
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// PUT /api/admin/christmas-orders/:id — marker som varslet
app.put('/api/admin/christmas-orders/:id', requireAdmin, async (req, res) => {
  const { notified, via } = req.body;
  try {
    if (notified === false) {
      await pool.query(`UPDATE christmas_orders SET notified_at = NULL, notified_via = NULL WHERE id = ?`, [req.params.id]);
    } else {
      await pool.query(
        `UPDATE christmas_orders SET notified_at = NOW(), notified_via = ? WHERE id = ?`,
        [via || 'ukjent', req.params.id]
      );
    }
    // Varen er klar: nå kan det reserverte Vipps-beløpet trekkes
    let vipps_trukket = false, vipps_feil = null;
    if (notified !== false) {
      const [[o]] = await pool.query(`SELECT * FROM christmas_orders WHERE id = ?`, [req.params.id]);
      if (o?.vipps_reference && !o.vipps_captured_at && !o.vipps_refunded_at && vippsAktiv()) {
        try { vipps_trukket = await trekkVipps(o); }
        catch (e) { vipps_feil = vippsFeiltekst(e); console.log('[Vipps trekk]', vipps_feil); }
      }
    }
    const [[r]] = await pool.query(`SELECT notified_at, notified_via FROM christmas_orders WHERE id = ?`, [req.params.id]);
    res.json({ ok: true, ...r, vipps_trukket, vipps_feil });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil: ' + err.message });
  }
});

// DELETE /api/admin/christmas-orders/:id
app.delete('/api/admin/christmas-orders/:id', requireAdmin, async (req, res) => {
  try {
    const [[o]] = await pool.query(`SELECT * FROM christmas_orders WHERE id = ?`, [req.params.id]);
    if (o?.vipps_reference && !o.vipps_refunded_at && vippsAktiv()) {
      if (o.vipps_captured_at) {
        return res.status(409).json({ error: 'Kunden har betalt med Vipps. Refunder beløpet før du sletter bestillingen.' });
      }
      // Reservert eller påbegynt betaling: frigjør pengene hos kunden
      await kansellerBetaling(o.vipps_reference).catch(e => console.log('[Vipps kanseller]', vippsFeiltekst(e)));
    }
    const [r] = await pool.query(`DELETE FROM christmas_orders WHERE id = ?`, [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Fant ikke bestillingen' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/reviews — public submission, awaits approval
app.post('/api/reviews', async (req, res) => {
  const { customer_name, review_text, rating, occasion, image_url } = req.body;
  if (!customer_name || !review_text) return res.status(400).json({ error: 'Navn og tilbakemelding er påkrevd' });
  if (review_text.length > 1000) return res.status(400).json({ error: 'Teksten er for lang (maks 1000 tegn)' });
  try {
    await pool.query(
      `INSERT INTO reviews (customer_name, review_text, rating, image_url, approved) VALUES (?, ?, ?, ?, FALSE)`,
      [customer_name.trim(), review_text.trim(), Math.min(5, Math.max(1, parseInt(rating) || 5)),
       (typeof image_url === 'string' && image_url.startsWith('data:image/') && image_url.length < 4_000_000) ? image_url : null]
    );

    // Notify Cecilie by email
    try {
      const transporter = createTransporter();
      await transporter.sendMail({
        from: `"Kakefrue" <${process.env.SMTP_FROM || 'cecilie@kakefrue.no'}>`,
        to: 'cecilie@kakefrue.no',
        subject: `⭐ Ny anbefaling fra ${customer_name.trim()}`,
        html: `
          <div style="font-family:sans-serif; max-width:560px; margin:0 auto; background:#FAF6F0; padding:32px; border-radius:12px;">
            <h2 style="color:#3D2B5A; margin-bottom:4px;">Ny anbefaling mottatt!</h2>
            <p style="opacity:0.6; margin-top:0;">Fra: <strong>${customer_name.trim()}</strong></p>
            <div style="background:#fff; border-radius:8px; padding:20px; margin:20px 0; border-left:4px solid #8B72BE;">
              <p style="font-style:italic; line-height:1.7; margin:0;">"${review_text.trim()}"</p>
            </div>
            <p>Gå inn i <a href="https://www.kakefrue.no/admin.html" style="color:#8B72BE;">adminpanelet</a> for å godkjenne eller avvise anbefalingen.</p>
            <p style="font-size:0.85rem; opacity:0.5; margin-top:24px;">– Kakefrue varslingssystem</p>
          </div>
        `
      });
    } catch (mailErr) {
      console.log('[Review notify] Email not sent:', mailErr.message);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/reviews
app.get('/api/reviews', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, customer_name, review_text, rating, image_url, created_at FROM reviews WHERE approved = TRUE ORDER BY sort_order ASC, created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/special-request
app.post('/api/special-request', async (req, res) => {
  const { customer_name, phone, email, message } = req.body;

  // Kunden far beskjed om at forespoerselen er mottatt, sa den MA lagres.
  // Tidligere ble den bare skrevet til konsollen og forsvant.
  if (!customer_name || !phone) {
    return res.status(400).json({ error: 'Navn og telefonnummer må fylles ut' });
  }

  try {
    const [r] = await pool.query(
      `INSERT INTO special_requests (customer_name, phone, email, message)
       VALUES (?, ?, ?, ?)`,
      [customer_name, phone, email || '', message || '']
    );

    // Varsle Cecilie. Feiler e-posten, star forespoerselen fortsatt i basen.
    try {
      const t = createTransporter();
      if (t) {
        await t.sendMail({
          from: `"Kakefrue" <${process.env.SMTP_FROM || 'cecilie@kakefrue.no'}>`,
          to: 'cecilie@kakefrue.no',
          subject: `Ny spesialbestilling – ${customer_name}`,
          text: [
            'Ny spesialbestilling fra bookingskjemaet:',
            '',
            `Navn:     ${customer_name}`,
            `Telefon:  ${phone}`,
            `E-post:   ${email || '(ikke oppgitt)'}`,
            '',
            message || '(ingen melding)',
            '',
            'Kunden har fått beskjed om at du tar kontakt innen 1–2 virkedager.'
          ].join('\n')
        });
      }
    } catch (e) {
      console.error('[Special Request] e-post feilet:', e.message);
    }

    res.json({ success: true, id: r.insertId,
               message: 'Din spesialbestilling er mottatt! Vi tar kontakt snart.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/admin/special-requests
app.get('/api/admin/special-requests', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM special_requests ORDER BY handled ASC, created_at DESC`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.put('/api/admin/special-requests/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`UPDATE special_requests SET handled = ? WHERE id = ?`,
      [req.body.handled ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.delete('/api/admin/special-requests/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM special_requests WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/pricing
app.get('/api/pricing', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM pricing ORDER BY category, item_key`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// ============================================================
// Payment API
// ============================================================

// POST /api/payment/sumup/checkout
app.post('/api/payment/sumup/checkout', async (req, res) => {
  const { booking_id, amount, description } = req.body;
  if (!booking_id || !amount) return res.status(400).json({ error: 'Mangler felter' });

  try {
    const reference = `KF-${booking_id}-${Date.now()}`;
    const returnUrl = `${req.protocol}://${req.get('host')}/book.html?payment_complete=1&booking_id=${booking_id}`;

    const checkout = await createSumUpCheckout({
      amount: parseFloat(amount),
      currency: 'NOK',
      description: description || `Kakefrue bestilling #${booking_id}`,
      returnUrl,
      reference
    });

    res.json(checkout);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Betalingsfeil' });
  }
});

// GET /api/payment/sumup/status/:id
app.get('/api/payment/sumup/status/:id', async (req, res) => {
  try {
    const status = await getSumUpCheckoutStatus(req.params.id);
    res.json(status);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Betalingsfeil' });
  }
});

// POST /api/payment/callback — SumUp webhook
app.post('/api/payment/callback', async (req, res) => {
  const { id, checkout_reference, status, amount } = req.body;
  console.log('[Payment Callback]', { id, checkout_reference, status });

  if (status === 'PAID' || status === 'SUCCESSFUL') {
    const bookingIdMatch = checkout_reference?.match(/KF-(\d+)-/);
    if (bookingIdMatch) {
      const bookingId = parseInt(bookingIdMatch[1]);
      try {
        await handlePaymentSuccess(bookingId, id, amount);
      } catch (err) {
        console.error('[Payment Callback] Error:', err);
      }
    }
  }

  res.json({ received: true });
});

// POST /api/payment/confirm — client-side payment confirmation after redirect
app.post('/api/payment/confirm', async (req, res) => {
  const { booking_id, checkout_id } = req.body;
  if (!booking_id || !checkout_id) return res.status(400).json({ error: 'Mangler felter' });

  try {
    const status = await getSumUpCheckoutStatus(checkout_id);
    if (status.status === 'PAID' || status.status === 'SUCCESSFUL' || checkout_id.startsWith('dev-')) {
      await handlePaymentSuccess(parseInt(booking_id), checkout_id, status.amount);
      res.json({ success: true, status: 'paid' });
    } else {
      res.json({ success: false, status: status.status });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Betalingsfeil' });
  }
});

// ============================================================
// Admin API
// ============================================================

// GET /api/admin/pageviews
app.get('/api/admin/pageviews', requireAdmin, async (req, res) => {
  try {
    // Total all time
    const [[{ total }]] = await pool.query(`SELECT COALESCE(SUM(count),0) as total FROM page_views`);

    // Last 30 days per day
    const [daily] = await pool.query(`
      SELECT view_date, SUM(count) as count
      FROM page_views
      WHERE view_date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
      GROUP BY view_date ORDER BY view_date ASC
    `);

    // Per page all time
    const [byPage] = await pool.query(`
      SELECT page, SUM(count) as count
      FROM page_views
      GROUP BY page ORDER BY count DESC
    `);

    // This month vs last month
    const [[{ this_month }]] = await pool.query(`
      SELECT COALESCE(SUM(count),0) as this_month FROM page_views
      WHERE view_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
    `);
    const [[{ last_month }]] = await pool.query(`
      SELECT COALESCE(SUM(count),0) as last_month FROM page_views
      WHERE view_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
        AND view_date < DATE_FORMAT(CURDATE(), '%Y-%m-01')
    `);

    res.json({ total, daily, byPage, this_month, last_month });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/admin/stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [[{ total_bookings }]] = await pool.query(`SELECT COUNT(*) as total_bookings FROM bookings`);
    const [[{ pending_bookings }]] = await pool.query(`SELECT COUNT(*) as pending_bookings FROM bookings WHERE status = 'pending'`);
    const [[{ abandoned_count }]] = await pool.query(`SELECT COUNT(*) as abandoned_count FROM abandoned_bookings WHERE contacted = FALSE`);
    const [[{ upcoming_bookings }]] = await pool.query(`SELECT COUNT(*) as upcoming_bookings FROM bookings WHERE booking_date >= CURDATE() AND status != 'cancelled'`);
    const [[{ pending_tastings }]] = await pool.query(`SELECT COUNT(*) as pending_tastings FROM tastings WHERE status = 'pending'`);
    const [[{ completed_bookings }]] = await pool.query(`SELECT COUNT(*) as completed_bookings FROM bookings WHERE status = 'completed'`);

    res.json({ total_bookings, pending_bookings, abandoned_count, upcoming_bookings, pending_tastings, completed_bookings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/admin/dates
app.get('/api/admin/dates', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM available_dates ORDER BY date ASC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/admin/dates
app.post('/api/admin/dates', requireAdmin, async (req, res) => {
  const { date, max_capacity, allows_delivery, notes } = req.body;
  if (!date) return res.status(400).json({ error: 'Dato er påkrevd' });

  try {
    const [result] = await pool.query(
      `INSERT INTO available_dates (date, max_capacity, allows_delivery, notes) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE max_capacity = VALUES(max_capacity), allows_delivery = VALUES(allows_delivery), notes = VALUES(notes)`,
      [date, max_capacity || 2, allows_delivery !== false, notes || null]
    );
    res.json({ id: result.insertId || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// DELETE /api/admin/dates/:id
app.delete('/api/admin/dates/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM available_dates WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/admin/bookings
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*, c.full_name, c.phone, c.email
       FROM bookings b
       JOIN customers c ON b.customer_id = c.id
       ORDER BY b.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/admin/bookings/:id
app.get('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  try {
    const [[booking]] = await pool.query(
      `SELECT b.*, c.full_name, c.phone, c.email
       FROM bookings b JOIN customers c ON b.customer_id = c.id
       WHERE b.id = ?`,
      [req.params.id]
    );
    if (!booking) return res.status(404).json({ error: 'Ikke funnet' });

    const [items] = await pool.query(`SELECT * FROM booking_items WHERE booking_id = ?`, [req.params.id]);
    res.json({ ...booking, items });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// DELETE /api/admin/bookings/:id
app.delete('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Frigjor plassen paa datoen igjen
    const [[b]] = await conn.query(`SELECT booking_date FROM bookings WHERE id = ?`, [id]);
    // booking_items har fremmednokkel uten cascade og maa bort foerst
    await conn.query(`DELETE FROM booking_items WHERE booking_id = ?`, [id]).catch(() => {});
    const [r] = await conn.query(`DELETE FROM bookings WHERE id = ?`, [id]);
    if (b?.booking_date) {
      await conn.query(
        `UPDATE available_dates SET current_bookings = GREATEST(current_bookings - 1, 0) WHERE date = ?`,
        [b.booking_date]
      ).catch(() => {});
    }
    await conn.commit();
    if (!r.affectedRows) return res.status(404).json({ error: 'Fant ikke bestillingen' });
    res.json({ success: true });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('Sletting av bestilling feilet:', err);
    res.status(500).json({ error: 'Kunne ikke slette: ' + err.message });
  } finally {
    conn.release();
  }
});

// PUT /api/admin/bookings/:id
app.put('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  const { status, admin_notes, deposit_paid, total_amount } = req.body;
  try {
    const fields = [];
    const values = [];
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (admin_notes !== undefined) { fields.push('admin_notes = ?'); values.push(admin_notes); }
    if (deposit_paid !== undefined) { fields.push('deposit_paid = ?'); values.push(deposit_paid); }
    if (total_amount !== undefined) { fields.push('total_amount = ?'); values.push(total_amount); }

    if (!fields.length) return res.status(400).json({ error: 'Ingen felter å oppdatere' });

    values.push(req.params.id);
    await pool.query(`UPDATE bookings SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/admin/abandoned
app.get('/api/admin/abandoned', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ab.*, c.full_name, c.phone, c.email
       FROM abandoned_bookings ab
       JOIN customers c ON ab.customer_id = c.id
       ORDER BY ab.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/admin/send-sms
app.post('/api/admin/send-sms', requireAdmin, async (req, res) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM;
  if (!accountSid || !authToken || !fromNumber) {
    return res.status(503).json({ error: 'SMS ikke konfigurert' });
  }
  const { to, message } = req.body;
  try {
    const params = new URLSearchParams();
    params.append('From', fromNumber);
    params.append('To', to);
    params.append('Body', message);
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      }
    );
    if (!twilioRes.ok) {
      const errData = await twilioRes.json().catch(() => ({}));
      return res.status(502).json({ error: errData.message || 'Twilio-feil' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil ved SMS-sending' });
  }
});

// PUT /api/admin/abandoned/:id
app.put('/api/admin/abandoned/:id', requireAdmin, async (req, res) => {
  const { contacted } = req.body;
  try {
    await pool.query(`UPDATE abandoned_bookings SET contacted = ? WHERE id = ?`, [contacted, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// DELETE /api/admin/abandoned/:id
app.delete('/api/admin/abandoned/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM abandoned_bookings WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/admin/customers
app.get('/api/admin/customers', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, COUNT(b.id) as booking_count
      FROM customers c
      LEFT JOIN bookings b ON b.customer_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/admin/customers — manually add a customer
app.post('/api/admin/customers', requireAdmin, async (req, res) => {
  const { full_name, phone, email } = req.body;
  if (!full_name || !phone) return res.status(400).json({ error: 'Navn og telefon er påkrevd' });
  try {
    const [result] = await pool.query(
      `INSERT INTO customers (full_name, phone, email) VALUES (?, ?, ?)`,
      [full_name, phone, email || null]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// DELETE /api/admin/customers/:id
app.delete('/api/admin/customers/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM customers WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil – kunden kan ha tilknyttede bestillinger' });
  }
});

// POST /api/admin/send-email
// Samme julepalett og jul-hero-bildet som suksess-skjermen pa jul.html, sa
// e-posten matcher det kunden allerede har sett der - bildet gar over HELE
// eposten (ikke et kort pa en brun side). "Caveat" er en lettere-lest
// handskrift enn Dancing Script, brukt pa brodteksten; Dancing Script er
// forbeholdt hilsen/signatur i toppen, som en liten hoytidelig detalj.
// Meldingsteksten kan inneholde en linje "📍 Åpne i Google Maps: <url>" -
// den fjernes, og selve adresselinjen ("Adresse: ...") blir i stedet en
// vanlig, inline tekstlenke til kartet - ingen egen knapp.
const HENTEADRESSE = 'Snarvegen 8, 3925 Porsgrunn';
const googleMapsLenke = sted => sted ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(sted) : '';

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Meldingsteksten til bestillingsbekreftelsen (samme julepost-tema som hentemeldingene).
// Kun bestillinger med henting/marked (ikke levering) har en fast avhentingsdag -
// derfor star refusjons-forbeholdet kun der, og adressen far Google Maps-lenke.
const JULEPOST_SIGNATUR = 'En varm juleklem sendes deg fra\nKakefrue';
function bestillingsbekreftelseTekst(o, total, produktlinjer, levering) {
  const fornavn = (o.full_name || '').trim().split(' ')[0];
  const erHenting = levering === 'henting' || levering === 'marked';
  const adresse = levering === 'levering' ? (o.address || '')
    : levering === 'marked' ? (o.address || '') : HENTEADRESSE;
  // Levering: adressen star allerede i "Leveres til X" - ingen egen Adresse-linje
  // (var dobbelt opp for). Henting/marked far en egen Adresse-linje siden
  // "Hentes hos Kakefrue"/"Hentes pa julemarkedet" ikke selv nevner adressen.
  const leveringstekst = levering === 'levering' ? `Leveres til ${adresse}`
    : levering === 'marked' ? `Hentes på julemarkedet\nAdresse: ${adresse}` : `Hentes hos Kakefrue\nAdresse: ${adresse}`;
  const kartLinje = adresse ? `\n📍 Åpne i Google Maps: ${googleMapsLenke(adresse)}` : '';

  return `Hei ${fornavn}!

Tusen takk for bestillingen din! Betalingen er godkjent, og bestillingen er bekreftet.

Du har bestilt:
${produktlinjer}
Totalt: ${total} kr

${leveringstekst}${kartLinje}
${erHenting ? '\nHvis bestillingen ikke hentes innen avtalt hentedag, bortfaller retten til refusjon.' : ''}

${JULEPOST_SIGNATUR}`;
}

function julEpostHtml(name, message) {
  const kartRegex = /^📍\s*Åpne i Google Maps:\s*(\S+)\s*$/m;
  const match = message.match(kartRegex);
  let before = message, after = '', kartUrl = null;
  if (match) {
    kartUrl = match[1];
    const idx = message.indexOf(match[0]);
    before = message.slice(0, idx).replace(/\n+$/, '');
    after = message.slice(idx + match[0].length).replace(/^\n+/, '');
  }
  // Gjor selve adressen (etter "Adresse:" eller "Leveres til") til en lenke, inne i teksten.
  const lenkAdresse = (txt) => !kartUrl ? esc(txt) : esc(txt).replace(
    /(Adresse:\s*|Leveres til\s*)(.+)/,
    (m0, label, adr) => `${label}<a href="${kartUrl}" style="color:#F3E9D2; text-decoration:underline;">${adr}</a>`
  );
  // Avsnitt-for-avsnitt (delt pa blanke linjer). Hele teksten i Dancing Script -
  // Cecilie ville ha samme skrift gjennomgaende, ikke ulik font pa hilsen/signatur
  // vs. brodtekst (2026-09-16).
  const paragrafer = (txt, senterForste, senterSiste) => {
    if (!txt) return '';
    const deler = txt.split(/\n{2,}/).filter(p => p.trim());
    return deler.map((p, i) => {
      const senter = (senterForste && i === 0) || (senterSiste && i === deler.length - 1);
      const storrelse = senter ? '1.7rem' : '1.85rem';
      const innhold = senter ? esc(p) : lenkAdresse(p);
      return `<div style="font-family:'Dancing Script',cursive; font-weight:700; color:#F3E9D2; font-size:${storrelse}; line-height:1.5; white-space:pre-wrap; margin:0 0 28px; text-align:${senter ? 'center' : 'left'};">${innhold}</div>`;
    }).join('');
  };

  return `<!DOCTYPE html>
<html lang="nb"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Dancing+Script:wght@700&display=swap');</style>
</head><body style="margin:0;">
  <div style="background-color:#230D0A;
              background-image:linear-gradient(180deg, rgba(35,13,10,0.30) 0%, rgba(35,13,10,0.55) 35%, rgba(35,13,10,0.68) 100%), url('https://kakefrue.no/assets/jul-hero.jpg');
              background-size:cover; background-position:center top; background-repeat:no-repeat;
              padding:40px 20px 36px;">
    <div style="max-width:500px; margin:0 auto; text-align:center;">
      <div style="font-size:1.9rem; margin-bottom:14px; line-height:1;">🎄</div>
      <img src="https://kakefrue.no/assets/kakefrue-logo-circle.png" alt="Kakefrue" width="130" style="width:130px; max-width:55%; height:auto; display:inline-block;">
      <p style="font-family:'Dancing Script',cursive; color:#DDAD88; font-size:1.6rem; margin:14px 0 0; font-weight:700;">God jul!</p>
    </div>
    <div style="max-width:480px; margin:18px auto 0;">
      ${paragrafer(before, true, false)}
      ${paragrafer(after, false, true)}
    </div>
    <div style="max-width:480px; margin:8px auto 0; text-align:center;">
      <p style="color:rgba(243,233,210,0.6); font-size:0.76rem; margin:0; font-family:'Lato',Arial,sans-serif;">Porsgrunn · cecilie@kakefrue.no</p>
    </div>
  </div>
</body></html>`;
}

// Internt varsel til Cecilie selv nar en julebestilling betales med Vipps.
// Samme julepost-visuell (jul-hero.jpg, logo, varm farge) som kunde-epostene,
// siden det handler om en julebestilling - men vanlig lesbar Lato-liste i
// stedet for handskrift-avsnitt, siden dette er et arbeidsvarsel hun skal
// skumlese raskt, ikke et personlig brev.
function internVarselJulHtml(o, total, produktlisteHtml, leveringstekst) {
  return `<!DOCTYPE html>
<html lang="nb"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Lato:wght@400;700&display=swap');</style>
</head><body style="margin:0;">
  <div style="background-color:#230D0A;
              background-image:linear-gradient(180deg, rgba(35,13,10,0.55) 0%, rgba(35,13,10,0.72) 40%, rgba(35,13,10,0.85) 100%), url('https://kakefrue.no/assets/jul-hero.jpg');
              background-size:cover; background-position:center top; background-repeat:no-repeat;
              padding:36px 20px 32px; font-family:'Lato',Arial,sans-serif;">
    <div style="max-width:480px; margin:0 auto; text-align:center;">
      <div style="font-size:1.6rem; margin-bottom:10px; line-height:1;">🎄</div>
      <img src="https://kakefrue.no/assets/kakefrue-logo-circle.png" alt="Kakefrue" width="90" style="width:90px; max-width:40%; height:auto; display:inline-block;">
    </div>
    <div style="max-width:460px; margin:20px auto 0; background:rgba(35,13,10,0.35); border:1px solid rgba(243,233,210,0.18); border-radius:12px; padding:22px 24px;">
      <p style="font-family:'Playfair Display',serif; font-weight:700; color:#F3E9D2; font-size:1.2rem; margin:0 0 14px;">Ny julebestilling – betalt med Vipps</p>
      <p style="color:#F3E9D2; font-size:0.95rem; margin:0 0 12px;"><strong>${escHtml(o.full_name)}</strong> · ${escHtml(o.phone)}${o.email ? ' · ' + escHtml(o.email) : ''}</p>
      <ul style="color:#F3E9D2; font-size:0.92rem; margin:0 0 12px; padding-left:20px;">${produktlisteHtml}</ul>
      <p style="color:#F3E9D2; font-size:0.95rem; margin:0 0 4px;"><strong>Totalt ${total} kr</strong> · ${leveringstekst}</p>
      ${o.note ? `<p style="color:rgba(243,233,210,0.85); font-size:0.88rem; margin:8px 0 0;"><strong>Kommentar:</strong> ${escHtml(o.note)}</p>` : ''}
    </div>
    <div style="max-width:460px; margin:18px auto 0; text-align:center;">
      <a href="${nettstedUrl()}/admin.html" style="color:#F3E9D2; text-decoration:underline; font-size:0.9rem;">Se i adminpanelet →</a>
    </div>
  </div>
</body></html>`;
}

// Generell kunde-epost (ikke julebestilling) - forsidebildet fra kakefrue.no i
// stedet for hvit bakgrunn, men vanlig lesbar Lato-brodtekst (ikke handskrift-
// fonten fra julepost-temaet, som er forbeholdt julebestillingene).
function standardEpostHtml(name, message) {
  const avsnitt = esc(message).split(/\n{2,}/).filter(p => p.trim())
    .map(p => `<p style="margin:0 0 18px; white-space:pre-wrap;">${p}</p>`).join('');
  return `<!DOCTYPE html>
<html lang="nb"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Lato:wght@400;700&display=swap');</style>
</head><body style="margin:0;">
  <div style="background-color:#2A1B14;
              background-image:linear-gradient(180deg, rgba(42,27,20,0.38) 0%, rgba(42,27,20,0.62) 40%, rgba(42,27,20,0.82) 100%), url('https://kakefrue.no/assets/forside-hero.jpg');
              background-size:cover; background-position:center; background-repeat:no-repeat;
              padding:40px 20px 36px; font-family:'Lato',Arial,sans-serif;">
    <div style="max-width:480px; margin:0 auto; text-align:center;">
      <img src="https://kakefrue.no/assets/kakefrue-logo-circle.png" alt="Kakefrue" width="110" style="width:110px; max-width:50%; height:auto; display:inline-block;">
      <p style="font-style:italic; color:rgba(250,247,244,0.7); font-size:0.8rem; letter-spacing:0.04em; margin:12px 0 0;">Håndlagde kaker i Porsgrunn</p>
    </div>
    <div style="max-width:480px; margin:24px auto 0;">
      <p style="font-family:'Playfair Display',serif; font-weight:700; color:#FAF7F4; font-size:1.5rem; margin:0 0 20px;">Hei ${esc(name || '')},</p>
      <div style="color:#FAF7F4; font-size:1rem; line-height:1.75;">${avsnitt}</div>
      <p style="font-family:'Playfair Display',serif; color:#FAF7F4; font-size:1.05rem; margin:24px 0 0;">Med kjærlig hilsen,<br><strong>Cecilie – Kakefrue</strong></p>
    </div>
    <div style="max-width:480px; margin:20px auto 0; text-align:center;">
      <p style="color:rgba(250,247,244,0.55); font-size:0.76rem; margin:0;">Porsgrunn · cecilie@kakefrue.no</p>
    </div>
  </div>
</body></html>`;
}

app.post('/api/admin/send-email', requireAdmin, async (req, res) => {
  const { to, name, subject, message, theme } = req.body;
  if (!to || !subject || !message) return res.status(400).json({ error: 'Mangler felt' });

  // If SMTP not configured, tell client to use mailto fallback
  if (!process.env.SMTP_HOST) {
    return res.json({ ok: true, mailto_fallback: true });
  }

  const transporter = createTransporter();
  const html = theme === 'jul' ? julEpostHtml(name, message) : standardEpostHtml(name, message);
  try {
    await transporter.sendMail({
      from: `"Kakefrue" <${process.env.SMTP_FROM || 'cecilie@kakefrue.no'}>`,
      to,
      subject,
      html
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: 'Serverfeil ved e-postsending' });
  }
});

// GET /api/admin/tastings
app.get('/api/admin/tastings', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM tastings ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// PUT /api/admin/tastings/:id
app.put('/api/admin/tastings/:id', requireAdmin, async (req, res) => {
  const { status, notes, deposit_deducted, paid } = req.body;
  try {
    const fields = [];
    const values = [];
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (notes !== undefined) { fields.push('notes = ?'); values.push(notes); }
    if (deposit_deducted !== undefined) { fields.push('deposit_deducted = ?'); values.push(deposit_deducted); }
    if (paid !== undefined) { fields.push('paid = ?'); values.push(paid); }

    if (!fields.length) return res.status(400).json({ error: 'Ingen felter' });
    values.push(req.params.id);
    await pool.query(`UPDATE tastings SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// Courses Admin
app.get('/api/admin/courses', requireAdmin, async (req, res) => {
  try {
    const [courses] = await pool.query(`SELECT * FROM courses ORDER BY created_at DESC`);
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.post('/api/admin/courses', requireAdmin, async (req, res) => {
  const { title, description, date, time_start, duration_hours, price, max_participants, what_to_bring } = req.body;
  if (!title) return res.status(400).json({ error: 'Tittel er påkrevd' });
  try {
    const [result] = await pool.query(
      `INSERT INTO courses (title, description, date, time_start, duration_hours, price, max_participants, what_to_bring) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description || null, date || null, time_start || null, duration_hours || 3, price || null, max_participants || 8, what_to_bring || null]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.put('/api/admin/courses/:id', requireAdmin, async (req, res) => {
  const { title, description, date, time_start, duration_hours, price, max_participants, what_to_bring, active } = req.body;
  try {
    await pool.query(
      `UPDATE courses SET title=?, description=?, date=?, time_start=?, duration_hours=?, price=?, max_participants=?, what_to_bring=?, active=? WHERE id=?`,
      [title, description || null, date || null, time_start || null, duration_hours || 3, price || null, max_participants || 8, what_to_bring || null, active !== false, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.delete('/api/admin/courses/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Paameldinger og interesser peker paa kurset og maa bort foerst,
    // ellers avviser databasen slettingen
    await conn.query(`DELETE FROM course_registrations WHERE course_id = ?`, [id]).catch(() => {});
    await conn.query(`DELETE FROM course_interests WHERE course_id = ?`, [id]).catch(() => {});
    const [r] = await conn.query(`DELETE FROM courses WHERE id = ?`, [id]);
    await conn.commit();
    if (!r.affectedRows) return res.status(404).json({ error: 'Fant ikke kurset' });
    res.json({ success: true });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('Kursletting feilet:', err);
    res.status(500).json({ error: 'Kunne ikke slette: ' + err.message });
  } finally {
    conn.release();
  }
});

app.get('/api/admin/courses/:id/registrations', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM course_registrations WHERE course_id = ? ORDER BY created_at DESC`, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// Reviews Admin
app.get('/api/admin/reviews', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM reviews ORDER BY sort_order ASC, created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.post('/api/admin/reviews', requireAdmin, async (req, res) => {
  const { customer_name, review_text, rating, image_url } = req.body;
  try {
    const [result] = await pool.query(
      `INSERT INTO reviews (customer_name, review_text, rating, image_url, approved) VALUES (?, ?, ?, ?, TRUE)`,
      [customer_name, review_text, rating || 5, image_url || null]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.put('/api/admin/reviews/:id', requireAdmin, async (req, res) => {
  const { approved, customer_name, review_text, rating, image_url } = req.body;
  try {
    const fields = [];
    const values = [];
    if (approved !== undefined) { fields.push('approved = ?'); values.push(approved); }
    if (customer_name !== undefined) { fields.push('customer_name = ?'); values.push(customer_name); }
    if (review_text !== undefined) { fields.push('review_text = ?'); values.push(review_text); }
    if (rating !== undefined) { fields.push('rating = ?'); values.push(rating); }
    // null fjerner bildet, en data-URL setter det
    if (image_url !== undefined) {
      const gyldig = image_url === null || image_url === ''
        || (typeof image_url === 'string' && image_url.startsWith('data:image/') && image_url.length < 4_000_000);
      if (!gyldig) return res.status(400).json({ error: 'Ugyldig bilde' });
      fields.push('image_url = ?'); values.push(image_url || null);
    }
    if (!fields.length) return res.status(400).json({ error: 'Ingen felter' });
    values.push(req.params.id);
    await pool.query(`UPDATE reviews SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/admin/reviews/reorder — [{id, sort_order}, ...]
app.post('/api/admin/reviews/reorder', requireAdmin, async (req, res) => {
  const { order } = req.body; // array of { id, sort_order }
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Ugyldig data' });
  try {
    await Promise.all(order.map(({ id, sort_order }) =>
      pool.query(`UPDATE reviews SET sort_order = ? WHERE id = ?`, [sort_order, id])
    ));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.delete('/api/admin/reviews/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM reviews WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// Pricing Admin
app.get('/api/admin/pricing', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM pricing ORDER BY category, item_key`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.post('/api/admin/pricing', requireAdmin, async (req, res) => {
  const { category, item_key, label, price, description } = req.body;
  if (!category || !item_key || !label || price === undefined) return res.status(400).json({ error: 'Mangler felter' });
  try {
    const [result] = await pool.query(
      `INSERT INTO pricing (category, item_key, label, price, description) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), price = VALUES(price), description = VALUES(description)`,
      [category, item_key, label, price, description || null]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.put('/api/admin/pricing/:id', requireAdmin, async (req, res) => {
  const { label, price, description } = req.body;
  try {
    await pool.query(
      `UPDATE pricing SET label = ?, price = ?, description = ? WHERE id = ?`,
      [label, price, description || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.delete('/api/admin/pricing/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM pricing WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// Settings Admin
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT k, v FROM settings`);
    const settings = {};
    rows.forEach(r => { settings[r.k] = r.v; });
    // Never expose password in response
    delete settings.admin_password;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const updates = req.body;
  try {
    for (const [k, v] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)`,
        [k, v]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// ============================================================
// Photos API
// ============================================================

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// GET /api/about-image — public, returns the about section image
// plass 0 = forsiden «Mer enn bare en kake», plass 1 = Om Kakefrue-siden
function bildeplass(v) { return String(v) === '1' ? -1 : 0; }

app.get('/api/about-image', async (req, res) => {
  try {
    const id = bildeplass(req.query.slot);
    const [[row]] = await pool.query(`SELECT image_data FROM photo_images WHERE photo_id = ?`, [id]);
    res.json({ url: row?.image_data || null });
  } catch (err) {
    res.json({ url: null });
  }
});

// POST /api/admin/about-image — upload about section image
app.post('/api/admin/about-image', requireAdmin, async (req, res) => {
  const { data, mimeType, slot } = req.body;
  if (!data || !mimeType) return res.status(400).json({ error: 'Mangler data' });
  try {
    const id = bildeplass(slot);
    const dataUrl = `data:${mimeType};base64,${data}`;
    await pool.query(`INSERT INTO photo_images (photo_id, image_data) VALUES (?, ?) ON DUPLICATE KEY UPDATE image_data = ?`, [id, dataUrl, dataUrl]);
    res.json({ ok: true, url: dataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Opplasting feilet: ' + err.message });
  }
});

// GET /api/photos — public, returns featured gallery photos
app.get('/api/photos', async (req, res) => {
  try {
    const cat = req.query.category || 'galleri';
    const [rows] = await pool.query(
      `SELECT id, filename, alt_text, image_data FROM photos WHERE featured = TRUE AND image_data IS NOT NULL AND COALESCE(category,'galleri')=? ORDER BY sort_order ASC, created_at DESC`,
      [cat]
    );
    res.json(rows.map(r => ({ id: r.id, filename: r.filename, alt_text: r.alt_text, url: r.image_data })));
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil: ' + err.message });
  }
});

// GET /api/admin/photos — all photos
app.get('/api/admin/photos', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, filename, alt_text, featured, sort_order, created_at, image_data, COALESCE(category,'galleri') AS category FROM photos ORDER BY sort_order ASC, created_at DESC`
    );
    res.json(rows.map(r => ({ id: r.id, filename: r.filename, alt_text: r.alt_text, featured: r.featured, sort_order: r.sort_order, created_at: r.created_at, url: r.image_data || null, category: r.category })));
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil: ' + err.message });
  }
});

// POST /api/admin/photos — upload base64 image, stored directly in photos table
app.post('/api/admin/photos', requireAdmin, async (req, res) => {
  const { data, mimeType, alt_text, category } = req.body;
  if (!data || !mimeType) return res.status(400).json({ error: 'Mangler data' });
  const filename = `photo_${Date.now()}.jpg`;
  const dataUrl = `data:${mimeType};base64,${data}`;
  try {
    const [result] = await pool.query(
      `INSERT INTO photos (filename, alt_text, featured, image_data, category) VALUES (?, ?, FALSE, ?, ?)`,
      [filename, alt_text || '', dataUrl, category || 'galleri']
    );
    res.json({ id: result.insertId, url: dataUrl, filename, category: category || 'galleri' });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: 'Opplasting feilet: ' + err.message });
  }
});

// PUT /api/admin/photos/:id — update alt text, featured, sort_order, category
app.put('/api/admin/photos/:id', requireAdmin, async (req, res) => {
  const { alt_text, featured, sort_order, category } = req.body;
  try {
    await pool.query(
      `UPDATE photos SET alt_text=COALESCE(?,alt_text), featured=COALESCE(?,featured), sort_order=COALESCE(?,sort_order), category=COALESCE(?,category) WHERE id=?`,
      [alt_text ?? null, featured ?? null, sort_order ?? null, category ?? null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// DELETE /api/admin/photos/:id
app.delete('/api/admin/photos/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM photo_images WHERE photo_id=?`, [req.params.id]);
    await pool.query(`DELETE FROM photos WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// ============================================================
// Catch-all: serve index.html for SPA-like routing
// ============================================================
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Ikke funnet' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// Start Server
// ============================================================
const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Kakefrue server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize DB:', err);
    process.exit(1);
  });
