
import type { AuthEmailSender } from './auth.service.js';
import type { EmailSender } from '../../common/utils/email-sender.js';

export class AuthEmailAdapter implements AuthEmailSender {
  constructor(private readonly emailSender: EmailSender) {}

  async sendPasswordResetCode(email: string, code: string): Promise<void> {
    await this.emailSender.send({
      to: email,
      subject: 'Password Reset Verification Code',
      text: [
        'You requested to reset your password.',
        '',
        `Your verification code is: ${code}`,
        '',
        'This code will expire soon. If you did not request this, please ignore this email.'
      ].join('\n')
    });
  }
}
