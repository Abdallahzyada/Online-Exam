

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { EmailSender, EmailMessage } from './email-sender.js';

export interface SmtpEmailSenderOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(options: SmtpEmailSenderOptions) {
    this.from = options.from;

    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: {
        user: options.user,
        pass: options.pass
      }
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text
    });
  }

    async verify(): Promise<void> {
     await this.transporter.verify();
    }
}
