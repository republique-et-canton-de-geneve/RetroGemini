import nodemailer from 'nodemailer';

const createMailerService = () => {
  const smtpEnabled = !!process.env.SMTP_HOST;
  const mailer = smtpEnabled
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined
      })
    : null;

  return { smtpEnabled, mailer };
};

export { createMailerService };
