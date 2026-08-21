import nodemailer from "nodemailer";

export interface AlertMessage { key: string; subject: string; text: string }

export class AlertNotifier {
  private readonly sentAt = new Map<string, number>();
  private readonly transport;
  constructor(private readonly options: { host: string; port: number; secure: boolean; user?: string; password?: string; from: string; recipients: string[]; cooldownMs?: number }) {
    this.transport = nodemailer.createTransport({ host: options.host, port: options.port, secure: options.secure, ...(options.user ? { auth: { user: options.user, pass: options.password ?? "" } } : {}) });
  }
  async send(message: AlertMessage): Promise<boolean> {
    const now = Date.now();
    if (now - (this.sentAt.get(message.key) ?? 0) < (this.options.cooldownMs ?? 15 * 60_000)) return false;
    await this.transport.sendMail({ from: this.options.from, to: this.options.recipients, subject: message.subject.slice(0, 160), text: message.text.slice(0, 4_000) });
    this.sentAt.set(message.key, now);
    return true;
  }

  async verify(): Promise<boolean> {
    await this.transport.verify();
    return true;
  }
}
