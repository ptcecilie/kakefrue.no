require('dotenv').config();
const nodemailer = require('nodemailer');

function createTransporter() {
  if (!process.env.SMTP_HOST) {
    // Return a mock transporter for development
    return {
      sendMail: async (opts) => {
        console.log('[EMAIL STUB] Would send email:', opts.subject, 'to', opts.to);
        return { messageId: 'stub-' + Date.now() };
      }
    };
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendBookingConfirmation(booking, customer) {
  const transporter = createTransporter();
  const html = `
    <div style="font-family: 'Lato', sans-serif; max-width: 600px; margin: 0 auto; background: #FAF6F0; padding: 32px; border-radius: 12px;">
      <h1 style="font-family: 'Playfair Display', serif; color: #4A3728; text-align: center;">Kakefrue</h1>
      <h2 style="color: #C9A884;">Bestilling bekreftet!</h2>
      <p>Hei ${customer.full_name},</p>
      <p>Tusen takk for din bestilling! Vi er så glade for at du har valgt Kakefrue til din spesielle anledning.</p>

      <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #4A3728;">Bestillingsdetaljer</h3>
        <p><strong>Bestillingsnr:</strong> #${booking.id}</p>
        <p><strong>Dato:</strong> ${new Date(booking.booking_date).toLocaleDateString('nb-NO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p><strong>Anledning:</strong> ${booking.occasion || 'Ikke spesifisert'}</p>
        <p><strong>Henting/levering:</strong> ${booking.delivery_type === 'levering' ? 'Levering' : 'Henting'}</p>
        ${booking.deposit_amount ? `<p><strong>Depositum betalt:</strong> kr ${booking.deposit_amount},-</p>` : ''}
      </div>

      <p>Vi tar kontakt med deg nærmere datoen for å bekrefte detaljer og eventuell leveringsadresse.</p>
      <p>Har du spørsmål, send oss gjerne en melding på Instagram eller e-post.</p>

      <div style="text-align: center; margin-top: 32px; color: #8B9E7A;">
        <p>Med kjærlig hilsen,<br><strong>Kakefrue</strong></p>
        <p style="font-size: 12px;">Porsgrunn · post@kakefrue.no</p>
      </div>
    </div>
  `;

  return transporter.sendMail({
    from: `"Kakefrue" <${process.env.SMTP_FROM || 'post@kakefrue.no'}>`,
    to: customer.email,
    subject: `Bestilling bekreftet – Kakefrue #${booking.id}`,
    html
  });
}

async function sendCourseConfirmation(course, registration) {
  const transporter = createTransporter();
  const html = `
    <div style="font-family: 'Lato', sans-serif; max-width: 600px; margin: 0 auto; background: #FAF6F0; padding: 32px; border-radius: 12px;">
      <h1 style="font-family: 'Playfair Display', serif; color: #4A3728; text-align: center;">Kakefrue</h1>
      <h2 style="color: #C9A884;">Kursplass bekreftet!</h2>
      <p>Hei ${registration.full_name},</p>
      <p>Din påmelding til kurset er bekreftet. Gleder meg til å se deg!</p>

      <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #4A3728;">${course.title}</h3>
        <p><strong>Dato:</strong> ${new Date(course.date).toLocaleDateString('nb-NO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p><strong>Tid:</strong> ${course.time_start ? course.time_start.substring(0, 5) : 'Avklares'}</p>
        <p><strong>Varighet:</strong> ${course.duration_hours} timer</p>
        ${course.what_to_bring ? `<p><strong>Ta med:</strong> ${course.what_to_bring}</p>` : ''}
      </div>

      <p>Vi ses snart!</p>

      <div style="text-align: center; margin-top: 32px; color: #8B9E7A;">
        <p>Med kjærlig hilsen,<br><strong>Kakefrue</strong></p>
        <p style="font-size: 12px;">Porsgrunn · post@kakefrue.no</p>
      </div>
    </div>
  `;

  return transporter.sendMail({
    from: `"Kakefrue" <${process.env.SMTP_FROM || 'post@kakefrue.no'}>`,
    to: registration.email,
    subject: `Kursplass bekreftet – ${course.title}`,
    html
  });
}

async function sendTastingConfirmation(tasting) {
  const transporter = createTransporter();
  const html = `
    <div style="font-family: 'Lato', sans-serif; max-width: 600px; margin: 0 auto; background: #FAF6F0; padding: 32px; border-radius: 12px;">
      <h1 style="font-family: 'Playfair Display', serif; color: #4A3728; text-align: center;">Kakefrue</h1>
      <h2 style="color: #C9A884;">Prøvesmaking registrert!</h2>
      <p>Hei ${tasting.full_name},</p>
      <p>Din forespørsel om prøvesmaking er mottatt! Vi tar kontakt for å bekrefte tid.</p>

      <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #4A3728;">Detaljer</h3>
        <p><strong>Ønsket dato:</strong> ${tasting.preferred_date ? new Date(tasting.preferred_date).toLocaleDateString('nb-NO') : 'Fleksibelt'}</p>
        ${tasting.choice_1 ? `<p><strong>1. valg:</strong> ${tasting.choice_1}</p>` : ''}
        ${tasting.choice_2 ? `<p><strong>2. valg:</strong> ${tasting.choice_2}</p>` : ''}
        ${tasting.choice_3 ? `<p><strong>3. valg:</strong> ${tasting.choice_3}</p>` : ''}
        <p><strong>Pris:</strong> kr 400,- (trekkes fra bryllupskake)</p>
      </div>

      <p>Gleder meg til å møte deg!</p>

      <div style="text-align: center; margin-top: 32px; color: #8B9E7A;">
        <p>Med kjærlig hilsen,<br><strong>Kakefrue</strong></p>
        <p style="font-size: 12px;">Porsgrunn · post@kakefrue.no</p>
      </div>
    </div>
  `;

  return transporter.sendMail({
    from: `"Kakefrue" <${process.env.SMTP_FROM || 'post@kakefrue.no'}>`,
    to: tasting.email,
    subject: 'Prøvesmaking – Kakefrue',
    html
  });
}

module.exports = { sendBookingConfirmation, sendCourseConfirmation, sendTastingConfirmation };
