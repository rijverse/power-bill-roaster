import nodemailer from 'nodemailer';
import { EmailService } from '../../services/email';
import { EmailConfig } from '../../config';

jest.mock('nodemailer');

const mockCreateTransport = nodemailer.createTransport as jest.MockedFunction<
  typeof nodemailer.createTransport
>;

describe('EmailService', () => {
  let mockSendMail: jest.Mock;
  let email: EmailConfig;

  beforeEach(() => {
    mockSendMail = jest.fn().mockResolvedValue({});
    mockCreateTransport.mockReturnValue({
      sendMail: mockSendMail,
    } as any);

    email = {
      to: 'test@example.com',
      from: 'from@example.com',
      host: 'smtp.test.com',
      port: 587,
      user: 'user@test.com',
      pass: 'password',
    };

    jest.clearAllMocks();
  });

  it('should configure SMTP transport correctly', () => {
    new EmailService(email);

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: 'user@test.com',
        pass: 'password',
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
  });

  it('should exempt localhost from requireTLS (Mailpit has no STARTTLS)', () => {
    email.host = 'localhost';
    new EmailService(email);
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ requireTLS: false })
    );
  });

  it('should use secure connection for port 465', () => {
    email.port = 465;
    new EmailService(email);

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: true,
        requireTLS: false,
      })
    );
  });

  it('should send email with correct content', async () => {
    const service = new EmailService(email);

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
    const service = new EmailService(email);

    await expect(
      service.send({ subject: 'Test', text: 'Test', html: '<p>Test</p>' })
    ).rejects.toThrow('SMTP Error');
  });
});
