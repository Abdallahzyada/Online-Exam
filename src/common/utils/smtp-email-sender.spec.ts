
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const sendMail = jest.fn<(options: {
  from: string;
  to: string;
  subject: string;
  text: string;
}) => Promise<void>>();

const verify = jest.fn<() => Promise<boolean>>();

const createTransport = jest.fn((_options: {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}) => ({
  sendMail,
  verify
}));

jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport }
}));

const { SmtpEmailSender } = await import('./smtp-email-sender.js');

describe('SmtpEmailSender', () => {
  const options = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'test-user',
    pass: 'test-password',
    from: 'noreply@example.com'
  };

  let sender: InstanceType<typeof SmtpEmailSender>;

  beforeEach(() => {
    sender = new SmtpEmailSender(options);
  });

  it('creates an SMTP transport with the configured connection details', () => {
    expect(createTransport).toHaveBeenCalledWith({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: {
        user: options.user,
        pass: options.pass
      }
    });
  });

  it('sends an email using the configured sender address', async () => {
    const message = {
      to: 'user@example.com',
      subject: 'Password reset',
      text: 'Your code is 123456'
    };

    await sender.send(message);

    expect(sendMail).toHaveBeenCalledWith({
      from: options.from,
      ...message
    });
  });

  it('propagates email delivery failures', async () => {
    const error = new Error('SMTP delivery failed');
    sendMail.mockRejectedValueOnce(error);

    await expect(sender.send({
      to: 'user@example.com',
      subject: 'Password reset',
      text: 'Your code is 123456'
    })).rejects.toThrow('SMTP delivery failed');
  });

  it('verifies the SMTP transport', async () => {
    verify.mockResolvedValueOnce(true);

    await sender.verify();

    expect(verify).toHaveBeenCalledTimes(1);
  });
});
