import { Injectable, Optional } from '@nestjs/common';
import {
  AdminUserInvitationMailDescription,
  MailDescription,
  UserMagicLinkMailDescription,
} from './MailDescriptions';
import { throwErr } from 'src/utils';
import { EMAIL_FAILED } from 'src/errors';
import { MailerService as NestMailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import * as Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

const sgMail = require('@sendgrid/mail');

type MailDescriptionType =
  | MailDescription
  | UserMagicLinkMailDescription
  | AdminUserInvitationMailDescription;

@Injectable()
export class MailerService {
  private sendGridInitialized = false;

  constructor(
    @Optional() private readonly nestMailerService: NestMailerService,
    private readonly configService: ConfigService,
  ) {
    // Initialize SendGrid if enabled (read from environment variables)
    const useSendGrid = this.configService.get('USE_SENDGRID');
    const sendGridApiKey = this.configService.get('SENDGRID_API_KEY');
    const mailerAddressFrom = this.configService.get('MAILER_ADDRESS_FROM');

    if (useSendGrid === 'true') {
      if (!sendGridApiKey) {
        console.error(
          'SendGrid is enabled but SENDGRID_API_KEY is not configured',
        );
        return;
      }
      if (!mailerAddressFrom) {
        console.error(
          'SendGrid is enabled but MAILER_ADDRESS_FROM is not configured',
        );
        return;
      }

      sgMail.setApiKey(sendGridApiKey);
      this.sendGridInitialized = true;
      console.log('SendGrid mail service initialized');
    }
  }

  /**
   * Determines which mailer is enabled
   * @returns 'sendgrid' | 'smtp' | false
   */
  private getEnabledMailer(): 'sendgrid' | 'smtp' | false {
    if (
      this.configService.get('USE_SENDGRID') === 'true' &&
      this.sendGridInitialized
    ) {
      return 'sendgrid';
    }
    if (this.configService.get('INFRA.MAILER_SMTP_ENABLE') === 'true') {
      return 'smtp';
    }
    return false;
  }

  /**
   * Takes an input mail description and spits out the Email subject required for it
   * @param mailDesc The mail description to get subject for
   * @returns The subject of the email
   */
  private resolveSubjectForMailDesc(mailDesc: MailDescriptionType): string {
    switch (mailDesc.template) {
      case 'team-invitation':
        return `A user has invited you to join a team workspace in Hoppscotch`;

      case 'user-invitation':
        return 'Sign in to Hoppscotch';
    }
  }

  /**
   * Compiles Handlebars template with provided variables
   * Reuses the existing .hbs template files used by SMTP mailer
   * @param mailDesc The mail description containing template and variables
   * @returns Compiled HTML string for the email body
   */
  private compileTemplate(mailDesc: MailDescriptionType): string {
    try {
      const templatePath = join(
        __dirname,
        'templates',
        `${mailDesc.template}.hbs`,
      );
      const templateSource = readFileSync(templatePath, 'utf-8');
      const template = Handlebars.compile(templateSource);
      return template(mailDesc.variables);
    } catch (error) {
      console.error('Error compiling email template:', error);
      throw error;
    }
  }

  /**
   * Sends email via SendGrid
   * @param to Receiver's email id
   * @param mailDesc Mail description
   * @returns SendGrid response
   */
  private async sendViaSendGrid(to: string, mailDesc: MailDescriptionType) {
    try {
      const mailerAddressFrom = this.configService.get('MAILER_ADDRESS_FROM');
      if (!mailerAddressFrom) {
        console.error('MAILER_ADDRESS_FROM is not configured');
        return throwErr(EMAIL_FAILED);
      }

      const msg = {
        to,
        from: mailerAddressFrom,
        subject: this.resolveSubjectForMailDesc(mailDesc),
        html: this.compileTemplate(mailDesc),
      };

      const res = await sgMail.send(msg);
      console.log('Email sent successfully via SendGrid to:', to);
      return res;
    } catch (error) {
      console.error('Error from SendGrid:', error);
      if (error.response) {
        console.error('SendGrid error response:', error.response.body);
      }
      return throwErr(EMAIL_FAILED);
    }
  }

  /**
   * Sends email via SMTP
   * @param to Receiver's email id
   * @param mailDesc Mail description
   * @returns SMTP response
   */
  private async sendViaSMTP(to: string, mailDesc: MailDescriptionType) {
    try {
      const res = await this.nestMailerService.sendMail({
        to,
        template: mailDesc.template,
        subject: this.resolveSubjectForMailDesc(mailDesc),
        context: mailDesc.variables,
      });
      return res;
    } catch (error) {
      console.error('Error from SMTP:', error);
      return throwErr(EMAIL_FAILED);
    }
  }

  /**
   * Sends an email to the given email address given a mail description
   * @param to Receiver's email id
   * @param mailDesc Definition of what email to be sent
   * @returns Response if email was send successfully or not
   */
  async sendEmail(
    to: string,
    mailDesc: MailDescription | UserMagicLinkMailDescription,
  ) {
    const mailer = this.getEnabledMailer();
    if (!mailer) return;

    if (mailer === 'sendgrid') {
      await this.sendViaSendGrid(to, mailDesc);
      return;
    }

    return this.sendViaSMTP(to, mailDesc);
  }

  /**
   * Sends user invitation email
   * @param to Receiver's email id
   * @param mailDesc Details of email to be sent for user invitation
   * @returns Response if email was send successfully or not
   */
  async sendUserInvitationEmail(
    to: string,
    mailDesc: AdminUserInvitationMailDescription,
  ) {
    const mailer = this.getEnabledMailer();
    if (!mailer) return;

    if (mailer === 'sendgrid') {
      return this.sendViaSendGrid(to, mailDesc);
    }

    return this.sendViaSMTP(to, mailDesc);
  }
}
