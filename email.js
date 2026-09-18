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
      <p>Tusen takk for din bestilling! Jeg er så glad for at du har valgt Kakefrue til din spesielle anledning.</p>

      <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #4A3728;">Bestillingsdetaljer</h3>
        <p><strong>Bestillingsnr:</strong> #${booking.id}</p>
        <p><strong>Dato:</strong> ${new Date(booking.booking_date).toLocaleDateString('nb-NO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p><strong>Anledning:</strong> ${booking.occasion || 'Ikke spesifisert'}</p>
        <p><strong>Henting/levering:</strong> ${booking.delivery_type === 'levering' ? 'Levering' : 'Henting'}</p>
        ${booking.deposit_amount ? `<p><strong>Depositum betalt:</strong> kr ${booking.deposit_amount},-</p>` : ''}
      </div>

      <p>Jeg tar kontakt med deg nærmere datoen for å bekrefte detaljer og eventuell leveringsadresse.</p>
      <p>Har du spørsmål, send meg gjerne en melding på Instagram eller e-post.</p>

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

// Kursets eget bilde (klingkurs-hero.jpg osv.) hvis satt, ellers generisk kurs-hero -
// relative stier (/assets/...) ma ha full url siden e-posten ikke har sidekontekst.
function absoluttBilde(sti, fallback) {
  if (!sti) return fallback;
  return sti.startsWith('/') ? `https://kakefrue.no${sti}` : sti;
}

// Lys, varm bilde-bakgrunn - matcher hvordan bakgrunnsbildet faktisk ser ut pa
// selve siden (kurs.html/provesmaking.html sin --side-foto/ph-slor, se main.css),
// IKKE den morke julebestilling-stemningen. Mork tekst (--brown) pa lys krem-slor.
function kontaktfelt() {
  return `
      <p style="color:rgba(61,36,32,0.6); font-size:0.8rem; margin:16px 0 6px;">Porsgrunn · cecilie@kakefrue.no · 900 33 039</p>
      <p style="margin:0;">
        <a href="https://instagram.com/kakefrue90" style="color:#7A5230; text-decoration:none; font-size:0.85rem; margin:0 8px;">Instagram</a>
        <a href="https://www.facebook.com/kakefrue" style="color:#7A5230; text-decoration:none; font-size:0.85rem; margin:0 8px;">Facebook</a>
      </p>`;
}

async function sendCourseConfirmation(course, registration) {
  const transporter = createTransporter();
  const bilde = absoluttBilde(course.image_url, 'https://kakefrue.no/assets/kurs-hero.jpg');
  const html = `<!DOCTYPE html>
<html lang="nb"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<style>:root{color-scheme:light;supported-color-schemes:light;} @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Lato:wght@400;700&display=swap');</style>
</head><body style="margin:0;">
  <div style="background-color:#FAF7F4;
              background-image:
                radial-gradient(ellipse 70% 55% at 50% 12%, rgba(255,251,245,0.88) 0%, rgba(255,250,243,0.6) 50%, transparent 85%),
                linear-gradient(180deg, rgba(255,252,247,0.5) 0%, rgba(255,252,247,0.2) 22%, rgba(250,247,244,0.3) 65%, rgba(250,247,244,0.94) 100%),
                url('${bilde}');
              background-size:cover; background-position:center; background-repeat:no-repeat;
              padding:40px 20px 36px; font-family:'Lato',Arial,sans-serif;">
    <div style="max-width:480px; margin:0 auto; text-align:center;">
      <img src="https://kakefrue.no/assets/kakefrue-logo-circle.png" alt="Kakefrue" width="110" style="width:110px; max-width:50%; height:auto; display:inline-block;">
      <p style="font-family:'Playfair Display',serif; font-weight:700; color:#3D2420; font-size:1.5rem; margin:16px 0 0; text-shadow:0 1px 14px rgba(255,252,247,0.9);">Kursplass bekreftet!</p>
    </div>
    <div style="max-width:480px; margin:22px auto 0; color:#3D2420; font-size:1rem; line-height:1.75; text-shadow:0 1px 10px rgba(255,252,247,0.6);">
      <p style="margin:0 0 18px;">Hei ${registration.full_name},</p>
      <p style="margin:0;">Din påmelding til kurset er bekreftet. Gleder meg til å se deg!</p>
    </div>
    <div style="max-width:480px; margin:22px auto 0; background:rgba(255,255,255,0.88); border:1px solid rgba(196,149,106,0.3); border-radius:12px; padding:22px 24px;">
      <p style="font-family:'Playfair Display',serif; font-weight:700; color:#3D2420; font-size:1.15rem; margin:0 0 12px;">${course.title}</p>
      <p style="color:#3D2420; font-size:0.95rem; margin:0 0 6px;"><strong>Dato:</strong> ${new Date(course.date).toLocaleDateString('nb-NO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      <p style="color:#3D2420; font-size:0.95rem; margin:0 0 6px;"><strong>Tid:</strong> ${course.time_start ? course.time_start.substring(0, 5) : 'Avklares'}</p>
      <p style="color:#3D2420; font-size:0.95rem; margin:0 0 6px;"><strong>Varighet:</strong> ${course.duration_hours} timer</p>
      ${course.address ? `<p style="color:#3D2420; font-size:0.95rem; margin:0${course.what_to_bring ? ' 0 6px' : ''};"><strong>Adresse:</strong> <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(course.address)}" style="color:#7A5230; text-decoration:underline;">${course.address}</a></p>` : ''}
      ${course.what_to_bring ? `<p style="color:#3D2420; font-size:0.95rem; margin:0;"><strong>Ta med:</strong> ${course.what_to_bring}</p>` : ''}
    </div>
    <div style="max-width:480px; margin:24px auto 0; text-align:center; text-shadow:0 1px 10px rgba(255,252,247,0.6);">
      <p style="font-family:'Playfair Display',serif; color:#3D2420; font-size:1.05rem; margin:0;">Ses snart!</p>
      ${kontaktfelt()}
    </div>
  </div>
</body></html>`;

  return transporter.sendMail({
    from: `"Kakefrue" <${process.env.SMTP_FROM || 'post@kakefrue.no'}>`,
    to: registration.email,
    subject: `Kursplass bekreftet – ${course.title}`,
    html
  });
}

async function sendTastingConfirmation(tasting) {
  const transporter = createTransporter();
  const bilde = 'https://kakefrue.no/assets/provesmaking-hero.jpg';
  const html = `<!DOCTYPE html>
<html lang="nb"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<style>:root{color-scheme:light;supported-color-schemes:light;} @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Lato:wght@400;700&display=swap');</style>
</head><body style="margin:0;">
  <div style="background-color:#FAF7F4;
              background-image:
                radial-gradient(ellipse 70% 55% at 50% 12%, rgba(255,251,245,0.88) 0%, rgba(255,250,243,0.6) 50%, transparent 85%),
                linear-gradient(180deg, rgba(255,252,247,0.5) 0%, rgba(255,252,247,0.2) 22%, rgba(250,247,244,0.3) 65%, rgba(250,247,244,0.94) 100%),
                url('${bilde}');
              background-size:cover; background-position:center; background-repeat:no-repeat;
              padding:40px 20px 36px; font-family:'Lato',Arial,sans-serif;">
    <div style="max-width:480px; margin:0 auto; text-align:center;">
      <img src="https://kakefrue.no/assets/kakefrue-logo-circle.png" alt="Kakefrue" width="110" style="width:110px; max-width:50%; height:auto; display:inline-block;">
      <p style="font-family:'Playfair Display',serif; font-weight:700; color:#3D2420; font-size:1.5rem; margin:16px 0 0; text-shadow:0 1px 14px rgba(255,252,247,0.9);">Prøvesmaking registrert!</p>
    </div>
    <div style="max-width:480px; margin:22px auto 0; color:#3D2420; font-size:1rem; line-height:1.75; text-shadow:0 1px 10px rgba(255,252,247,0.6);">
      <p style="margin:0 0 18px;">Hei ${tasting.full_name},</p>
      <p style="margin:0;">Din forespørsel om prøvesmaking er mottatt! Jeg tar kontakt for å bekrefte tid.</p>
    </div>
    <div style="max-width:480px; margin:22px auto 0; background:rgba(255,255,255,0.88); border:1px solid rgba(196,149,106,0.3); border-radius:12px; padding:22px 24px;">
      <p style="font-family:'Playfair Display',serif; font-weight:700; color:#3D2420; font-size:1.15rem; margin:0 0 12px;">Detaljer</p>
      <p style="color:#3D2420; font-size:0.95rem; margin:0 0 6px;"><strong>Ønsket dato:</strong> ${tasting.preferred_date ? new Date(tasting.preferred_date).toLocaleDateString('nb-NO') : 'Fleksibelt'}</p>
      ${tasting.choice_1 ? `<p style="color:#3D2420; font-size:0.95rem; margin:0 0 6px;"><strong>1. valg:</strong> ${tasting.choice_1}</p>` : ''}
      ${tasting.choice_2 ? `<p style="color:#3D2420; font-size:0.95rem; margin:0 0 6px;"><strong>2. valg:</strong> ${tasting.choice_2}</p>` : ''}
      ${tasting.choice_3 ? `<p style="color:#3D2420; font-size:0.95rem; margin:0 0 6px;"><strong>3. valg:</strong> ${tasting.choice_3}</p>` : ''}
      <p style="color:#3D2420; font-size:0.95rem; margin:0;"><strong>Pris:</strong> kr 500,- (trekkes fra bryllupskake)</p>
    </div>
    <div style="max-width:480px; margin:24px auto 0; text-align:center; text-shadow:0 1px 10px rgba(255,252,247,0.6);">
      <p style="font-family:'Playfair Display',serif; color:#3D2420; font-size:1.05rem; margin:0;">Gleder meg til å møte deg!</p>
      ${kontaktfelt()}
    </div>
  </div>
</body></html>`;

  return transporter.sendMail({
    from: `"Kakefrue" <${process.env.SMTP_FROM || 'post@kakefrue.no'}>`,
    to: tasting.email,
    subject: 'Prøvesmaking – Kakefrue',
    html
  });
}

module.exports = { sendBookingConfirmation, sendCourseConfirmation, sendTastingConfirmation, createTransporter, absoluttBilde };
