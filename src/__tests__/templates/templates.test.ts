import { generateCriticalEmail, generateWarningEmail } from '../../templates';

describe('Email Templates', () => {
  describe('generateCriticalEmail', () => {
    it('should generate critical email with correct subject', () => {
      const email = generateCriticalEmail(50, '123', '456');

      expect(email.subject).toContain('Stone Age');
    });

    it('should include balance in text', () => {
      const email = generateCriticalEmail(50.5, '123', '456');

      expect(email.text).toContain('৳50.50');
    });

    it('should include balance in HTML', () => {
      const email = generateCriticalEmail(50.5, '123', '456');

      expect(email.html).toContain('৳50.50');
    });

    it('should include account details', () => {
      const email = generateCriticalEmail(50, '13151091', '661120227647');

      expect(email.text).toContain('13151091');
      expect(email.text).toContain('661120227647');
      expect(email.html).toContain('13151091');
      expect(email.html).toContain('661120227647');
    });

    it('should include recharge link', () => {
      const email = generateCriticalEmail(50, '123', '456');

      expect(email.text).toContain('https://prepaid.desco.org.bd/');
      expect(email.html).toContain('https://prepaid.desco.org.bd/');
    });

    it('should generate valid HTML', () => {
      const email = generateCriticalEmail(50, '123', '456');

      expect(email.html).toContain('<!DOCTYPE html>');
      expect(email.html).toContain('</html>');
    });
  });

  describe('generateWarningEmail', () => {
    it('should generate warning email with correct subject', () => {
      const email = generateWarningEmail(120, '123', '456');

      expect(email.subject).toContain('Ghost You');
    });

    it('should include balance in text', () => {
      const email = generateWarningEmail(120.75, '123', '456');

      expect(email.text).toContain('৳120.75');
    });

    it('should include balance in HTML', () => {
      const email = generateWarningEmail(120.75, '123', '456');

      expect(email.html).toContain('৳120.75');
    });

    it('should include account details', () => {
      const email = generateWarningEmail(120, '13151091', '661120227647');

      expect(email.text).toContain('13151091');
      expect(email.text).toContain('661120227647');
      expect(email.html).toContain('13151091');
      expect(email.html).toContain('661120227647');
    });

    it('should generate valid HTML', () => {
      const email = generateWarningEmail(120, '123', '456');

      expect(email.html).toContain('<!DOCTYPE html>');
      expect(email.html).toContain('</html>');
    });
  });
});
