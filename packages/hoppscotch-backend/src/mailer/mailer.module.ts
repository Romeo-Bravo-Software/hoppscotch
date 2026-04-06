import { Global, Module } from '@nestjs/common';
import { MailerModule as NestMailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { MailerService } from './mailer.service';
import { loadInfraConfiguration } from 'src/infra-config/helper';
import { getMailerAddressFrom, getTransportOption } from './helper';

@Global()
@Module({
  imports: [],
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {
  static async register() {
    if (process.env.GENERATE_GQL_SCHEMA) return { module: MailerModule };

    const env = await loadInfraConfiguration();

    // Check SendGrid from environment variables (not DB)
    const useSendGrid = process.env.USE_SENDGRID === 'true';
    // Check SMTP from DB config
    const useSMTP = env.INFRA.MAILER_SMTP_ENABLE === 'true';

    // If both SendGrid and SMTP are disabled, return module without configuration
    if (!useSendGrid && !useSMTP) {
      console.log('Mailer module is disabled (both SendGrid and SMTP are off)');
      return {
        module: MailerModule,
      };
    }

    // If SendGrid is enabled, return module without SMTP configuration
    if (useSendGrid) {
      console.log('Mailer module enabled with SendGrid');
      return {
        module: MailerModule,
      };
    }

    // If SMTP is ENABLED, return the module with SMTP configuration
    console.log('Mailer module enabled with SMTP');

    // Determine transport configuration based on custom config flag
    const transportOption = getTransportOption(env);
    // Get mailer address from environment or config
    const mailerAddressFrom = getMailerAddressFrom(env);

    return {
      module: MailerModule,
      imports: [
        NestMailerModule.forRoot({
          transport: transportOption,
          defaults: {
            from: mailerAddressFrom,
          },
          template: {
            dir: __dirname + '/templates',
            adapter: new HandlebarsAdapter(),
          },
        }),
      ],
    };
  }
}
