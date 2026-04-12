require('dotenv').config();
const axios = require('axios');
const { pool } = require('./db');
const { addToCalendar } = require('./icloud');
const { sendBookingConfirmation } = require('./email');

// ============================================================
// SumUp Payment Integration
// ============================================================

const SUMUP_BASE = 'https://api.sumup.com/v0.1';

async function createSumUpCheckout({ amount, currency = 'NOK', description, returnUrl, reference }) {
  if (!process.env.SUMUP_API_KEY) {
    // Dev stub
    const checkoutId = 'dev-checkout-' + Date.now();
    return {
      id: checkoutId,
      checkout_reference: reference,
      amount,
      currency,
      status: 'PENDING',
      redirect_url: returnUrl + '?checkout_id=' + checkoutId
    };
  }

  const response = await axios.post(
    `${SUMUP_BASE}/checkouts`,
    {
      checkout_reference: reference,
      amount,
      currency,
      description,
      merchant_code: process.env.SUMUP_MERCHANT_CODE,
      return_url: returnUrl
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.SUMUP_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

async function getSumUpCheckoutStatus(checkoutId) {
  if (!process.env.SUMUP_API_KEY || checkoutId.startsWith('dev-checkout-')) {
    return { id: checkoutId, status: 'PAID', amount: 0 };
  }

  const response = await axios.get(
    `${SUMUP_BASE}/checkouts/${checkoutId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.SUMUP_API_KEY}`
      }
    }
  );

  return response.data;
}

async function handlePaymentSuccess(bookingId, paymentReference, amount) {
  const conn = await pool.getConnection();
  try {
    // Mark booking as deposit paid
    await conn.query(
      `UPDATE bookings SET deposit_paid = TRUE, payment_reference = ?, status = 'confirmed' WHERE id = ?`,
      [paymentReference, bookingId]
    );

    // Remove from abandoned bookings
    const [booking] = await conn.query(`SELECT * FROM bookings WHERE id = ?`, [bookingId]);
    const [customer] = await conn.query(`SELECT * FROM customers WHERE id = ?`, [booking[0].customer_id]);

    await conn.query(`DELETE FROM abandoned_bookings WHERE customer_id = ?`, [booking[0].customer_id]);

    // Add to iCloud calendar
    try {
      await addToCalendar(booking[0], customer[0].full_name);
    } catch (err) {
      console.error('[Calendar] Failed to add to calendar:', err.message);
    }

    // Send confirmation email
    if (customer[0].email) {
      try {
        await sendBookingConfirmation(booking[0], customer[0]);
      } catch (err) {
        console.error('[Email] Failed to send confirmation:', err.message);
      }
    }

    return { success: true };
  } finally {
    conn.release();
  }
}

// ============================================================
// Vipps Payment (Coming Soon)
// ============================================================

async function createVippsPayment(opts) {
  throw { status: 501, message: 'Vipps-betaling kommer snart! Bruk SumUp i mellomtiden.' };
}

module.exports = {
  createSumUpCheckout,
  getSumUpCheckoutStatus,
  handlePaymentSuccess,
  createVippsPayment
};
