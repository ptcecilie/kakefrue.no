// iCloud Calendar Integration
// TODO: Implement iCal integration to add bookings to "C-kake" calendar
//
// Options:
// 1. Use Apple Calendar via CalDAV (requires iCloud credentials in .env)
// 2. Generate .ics file and email to iCloud address
//
// For now, this generates an .ics file content that can be sent via email

function generateICSContent(booking, customerName) {
  const date = new Date(booking.booking_date);
  const dateStr = date.toISOString().replace(/[-:]/g, '').split('.')[0].substring(0, 8);

  const title = `${customerName} - ${booking.delivery_type === 'levering' ? 'leveres' : 'hentes'}`;
  const description = `Bestilling #${booking.id}\\nAnledning: ${booking.occasion || 'ukjent'}\\nGjester: ${booking.guest_count || 'ukjent'}`;

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Kakefrue//Kakefrue.no//NO
BEGIN:VEVENT
UID:kakefrue-booking-${booking.id}@kakefrue.no
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z
DTSTART;VALUE=DATE:${dateStr}
DTEND;VALUE=DATE:${dateStr}
SUMMARY:${title}
DESCRIPTION:${description}
CATEGORIES:Kakebestilling
END:VEVENT
END:VCALENDAR`;
}

async function addToCalendar(booking, customerName) {
  // TODO: Implement actual CalDAV push to iCloud "C-kake" calendar
  // CalDAV endpoint: https://caldav.icloud.com/
  // Requires: ICLOUD_USERNAME, ICLOUD_APP_PASSWORD in .env
  //
  // Example implementation:
  // const icsContent = generateICSContent(booking, customerName);
  // await calDAVClient.createEvent('C-kake', icsContent);

  const icsContent = generateICSContent(booking, customerName);
  console.log('[iCloud] Would add to calendar:', booking.id, customerName);
  console.log('[iCloud] ICS content generated, length:', icsContent.length);

  return { success: true, icsContent };
}

module.exports = { addToCalendar, generateICSContent };
