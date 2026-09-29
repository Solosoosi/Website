// Email is optional: without SMTP settings, messages are just logged so the
// site works out of the box. Sending never blocks or fails a booking.

export function createMailer(env, log = console) {
  if (!env.SMTP_HOST) {
    return {
      enabled: false,
      send(msg) {
        log.info(`[mail disabled] would send "${msg.subject}" to ${msg.to}`);
      },
    };
  }

  const port = Number(env.SMTP_PORT || 587);
  const transport = import('nodemailer').then(({ default: nodemailer }) =>
    nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    }),
  );
  const from = env.MAIL_FROM || env.SMTP_USER;

  return {
    enabled: true,
    send(msg) {
      transport
        .then((t) => t.sendMail({ from, ...msg }))
        .catch((err) => log.error(`[mail] failed to send "${msg.subject}" to ${msg.to}:`, err.message));
    },
  };
}

function formatDate(date, lang) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function bookingEmails({ booking, service, config }) {
  const { business } = config;
  const lang = booking.lang === 'en' ? 'en' : 'he';
  const name = business.name[lang];
  const when = `${formatDate(booking.date, lang)}, ${booking.time}`;

  const client =
    lang === 'he'
      ? {
          subject: `אישור פגישה – ${name}`,
          text: [
            `שלום ${booking.name},`,
            '',
            'הפגישה שלך נקבעה בהצלחה.',
            '',
            `סוג הפגישה: ${service.name.he}`,
            `מועד: ${when} (שעון ישראל)`,
            `משך: ${booking.duration} דקות`,
            `מספר אישור: ${booking.ref}`,
            '',
            `לשינוי או ביטול ניתן לפנות בטלפון ${business.phone}.`,
            '',
            'מחכה לפגוש אותך,',
            name,
          ].join('\n'),
        }
      : {
          subject: `Session confirmed – ${name}`,
          text: [
            `Hi ${booking.name},`,
            '',
            'Your session has been booked.',
            '',
            `Session: ${service.name.en}`,
            `When: ${when} (Israel time)`,
            `Length: ${booking.duration} minutes`,
            `Confirmation number: ${booking.ref}`,
            '',
            `To reschedule or cancel, please call ${business.phone}.`,
            '',
            'Looking forward to seeing you,',
            name,
          ].join('\n'),
        };

  const owner = {
    subject: `New booking: ${booking.name} – ${booking.date} ${booking.time}`,
    text: [
      `Service: ${service.name.en} / ${service.name.he}`,
      `When: ${booking.date} ${booking.time} (${booking.duration} min)`,
      `Name: ${booking.name}`,
      `Phone: ${booking.phone}`,
      `Email: ${booking.email || '-'}`,
      `Notes: ${booking.notes || '-'}`,
      `Language: ${lang}`,
      `Ref: ${booking.ref}`,
    ].join('\n'),
  };

  return { client, owner };
}
