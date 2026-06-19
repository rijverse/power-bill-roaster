import nodemailer from 'nodemailer';
import { EmailService } from '../../services/email';
import { Config } from '../../config';

jest.mock('nodemailer');

const mockCreateTransport = nodemailer.createTransport as jest.MockedFunction<
  typeof nodemailer.createTransport
>;

describe('EmailService', () => {
  let mockSendMail: jest.Mock;
  let config: Config;

  beforeEach(() => {
    mockSendMail = jest.fn().mockResolvedValue({});
    mockCreateTransport.mockReturnValue({
      sendMail: mockSendMail,
    } as any);

    config = {
      desco: { accountNo: '123', meterNo: '456' },
      email: { to: 'test@example.com', from: 'from@example.com' },
      smtp: {
        host: 'smtp.test.com',
        port: 587,
        user: 'user@test.com',
        pass: 'password',
      },
      thresholds: { low: 150, critical: 100 },
    };

    jest.clearAllMocks();
  });

  it('should configure SMTP transport correctly', () => {
    new EmailService(config);

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: {
        user: 'user@test.com',
        pass: 'password',
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
  });

  it('should use secure connection for port 465', () => {
    config.smtp.port = 465;
    new EmailService(config);

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: true,
      })
    );
  });

  it('should send email with correct content', async () => {
    const service = new EmailService(config);

    await service.send({
      subject: 'Test Subject',
      text: 'Test text',
      html: '<p>Test HTML</p>',
    });

    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'from@example.com',
      to: 'test@example.com',
      subject: 'Test Subject',
      text: 'Test text',
      html: '<p>Test HTML</p>',
    });
  });

  it('should propagate send errors', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP Error'));
    const service = new EmailService(config);

    await expect(
      service.send({ subject: 'Test', text: 'Test', html: '<p>Test</p>' })
    ).rejects.toThrow('SMTP Error');
  });
});
