require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { pool, initDB } = require('./db');
const { createSumUpCheckout, getSumUpCheckoutStatus, handlePaymentSuccess } = require('./payments');
const { sendTastingConfirmation, sendCourseConfirmation, createTransporter } = require('./email');

const app = express();
app.use(express.json({ limit: '25mb' }));

// ── Page view tracking ─────────────────────────────────────
const TRACKED_PAGES = {
  '/': 'Forside',
  '/index.html': 'Forside',
  '/bestill.html': 'Bestilling',
  '/meny.html': 'Meny',
  '/om-kakefrue.html': 'Om Kakefrue',
  '/kurs.html': 'Kurs',
  '/anbefalinger.html': 'Anbefalinger',
  '/provesmaking.html': 'Prøvesmaking'
};
app.use((req, res, next) => {
  const page = TRACKED_PAGES[req.path];
  if (page && req.method === 'GET') {
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

// ============================================================
// Public API
// ============================================================

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

// POST /api/reviews — public submission, awaits approval
app.post('/api/reviews', async (req, res) => {
  const { customer_name, review_text, rating, occasion } = req.body;
  if (!customer_name || !review_text) return res.status(400).json({ error: 'Navn og tilbakemelding er påkrevd' });
  if (review_text.length > 1000) return res.status(400).json({ error: 'Teksten er for lang (maks 1000 tegn)' });
  try {
    await pool.query(
      `INSERT INTO reviews (customer_name, review_text, rating, approved) VALUES (?, ?, ?, FALSE)`,
      [customer_name.trim(), review_text.trim(), Math.min(5, Math.max(1, parseInt(rating) || 5))]
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
  console.log('[Special Request]', { customer_name, phone, email, message });
  // TODO: Send email notification to admin
  res.json({ success: true, message: 'Din spesialbestilling er mottatt! Vi tar kontakt snart.' });
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
app.post('/api/admin/send-email', requireAdmin, async (req, res) => {
  const { to, name, subject, message } = req.body;
  if (!to || !subject || !message) return res.status(400).json({ error: 'Mangler felt' });

  // If SMTP not configured, tell client to use mailto fallback
  if (!process.env.SMTP_HOST) {
    return res.json({ ok: true, mailto_fallback: true });
  }

  const transporter = createTransporter();
  const html = `
    <div style="font-family: 'Lato', sans-serif; max-width: 600px; margin: 0 auto; background: #F5F2EC; padding: 32px; border-radius: 12px;">
      <h1 style="font-family: 'Playfair Display', serif; color: #2A1E3E; text-align: center;">Kakefrue</h1>
      <p>Hei ${name || ''},</p>
      <div style="white-space: pre-wrap; line-height: 1.7; margin: 20px 0;">${message.replace(/\n/g, '<br>')}</div>
      <div style="text-align: center; margin-top: 32px; color: #7A9E82;">
        <p>Med kjærlig hilsen,<br><strong>Cecilie – Kakefrue</strong></p>
        <p style="font-size: 12px;">Porsgrunn · cecilie@kakefrue.no</p>
      </div>
    </div>
  `;
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
  try {
    await pool.query(`DELETE FROM courses WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
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
  const { approved, customer_name, review_text, rating } = req.body;
  try {
    const fields = [];
    const values = [];
    if (approved !== undefined) { fields.push('approved = ?'); values.push(approved); }
    if (customer_name !== undefined) { fields.push('customer_name = ?'); values.push(customer_name); }
    if (review_text !== undefined) { fields.push('review_text = ?'); values.push(review_text); }
    if (rating !== undefined) { fields.push('rating = ?'); values.push(rating); }
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
// Catch-all: serve index.html for SPA-like routing
// ============================================================
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Ikke funnet' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// ============================================================
// Photos API
// ============================================================

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// GET /api/about-image — public, returns the about section image
app.get('/api/about-image', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT v FROM settings WHERE k = 'about_image_url'`);
    res.json({ url: rows[0]?.v || null });
  } catch (err) {
    res.json({ url: null });
  }
});

// POST /api/admin/about-image — upload about section image
app.post('/api/admin/about-image', requireAdmin, async (req, res) => {
  const { data, mimeType } = req.body;
  if (!data || !mimeType) return res.status(400).json({ error: 'Mangler data' });
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const filename = `about_${Date.now()}.${ext}`;
  const filepath = path.join(uploadsDir, filename);
  try {
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(filepath, buffer);
    const url = '/uploads/' + filename;
    await pool.query(`INSERT INTO settings (k, v) VALUES ('about_image_url', ?) ON DUPLICATE KEY UPDATE v = ?`, [url, url]);
    res.json({ ok: true, url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Opplasting feilet' });
  }
});

// GET /api/photos — public, returns featured photos
app.get('/api/photos', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, filename, alt_text FROM photos WHERE featured = TRUE ORDER BY sort_order ASC, created_at DESC`
    );
    res.json(rows.map(r => ({ ...r, url: '/uploads/' + r.filename })));
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// GET /api/admin/photos — all photos
app.get('/api/admin/photos', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, filename, alt_text, featured, sort_order, created_at FROM photos ORDER BY sort_order ASC, created_at DESC`);
    res.json(rows.map(r => ({ ...r, url: '/uploads/' + r.filename })));
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// POST /api/admin/photos — upload base64 image
app.post('/api/admin/photos', requireAdmin, async (req, res) => {
  const { data, mimeType, alt_text } = req.body;
  if (!data || !mimeType) return res.status(400).json({ error: 'Mangler data' });

  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const filename = `photo_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const filepath = path.join(uploadsDir, filename);

  try {
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(filepath, buffer);
    const [result] = await pool.query(
      `INSERT INTO photos (filename, alt_text, featured) VALUES (?, ?, FALSE)`,
      [filename, alt_text || '']
    );
    res.json({ id: result.insertId, url: '/uploads/' + filename, filename });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Opplasting feilet' });
  }
});

// PUT /api/admin/photos/:id — update alt text, featured, sort_order
app.put('/api/admin/photos/:id', requireAdmin, async (req, res) => {
  const { alt_text, featured, sort_order } = req.body;
  try {
    await pool.query(
      `UPDATE photos SET alt_text=COALESCE(?,alt_text), featured=COALESCE(?,featured), sort_order=COALESCE(?,sort_order) WHERE id=?`,
      [alt_text ?? null, featured ?? null, sort_order ?? null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
});

// DELETE /api/admin/photos/:id
app.delete('/api/admin/photos/:id', requireAdmin, async (req, res) => {
  try {
    const [[photo]] = await pool.query(`SELECT filename FROM photos WHERE id=?`, [req.params.id]);
    if (photo) {
      const fp = path.join(uploadsDir, photo.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await pool.query(`DELETE FROM photos WHERE id=?`, [req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Serverfeil' });
  }
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
