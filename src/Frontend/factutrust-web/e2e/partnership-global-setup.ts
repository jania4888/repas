/**
 * Ensures demo credentials exist for partnership video recording.
 * Uses DOC_EMAIL/DOC_PASSWORD if set; otherwise registers a fresh demo tenant via API.
 */
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = process.env.PARTNERSHIP_API_URL ?? 'https://localhost:7001/api';
const CREDS_FILE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'partnership',
  'expert-comptable',
  '.demo-credentials.json'
);

async function registerDemoUser(): Promise<{ email: string; password: string }> {
  const stamp = Date.now();
  const email = `demo.partnership.${stamp}@factutrust.local`;
  const password = 'DemoPartnership_Pw1!XyZ';

  const payload = {
    email,
    password,
    confirmPassword: password,
    firstName: 'Demo',
    lastName: 'Partenariat',
    companyName: 'Cabinet Partenaire Demo SARL',
    nif: '1234567A/B/C/000',
    taxRegime: 0,
    street: '10 Avenue Habib Bourguiba',
    city: 'Tunis',
    postalCode: '1000',
    governorate: 'Tunis',
    companyEmail: `contact.${stamp}@demo.factutrust.local`,
    phone: '98123456',
    warehouseName: 'Entrepôt Principal'
  };

  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Demo registration failed (${res.status}): ${body}`);
  }

  return { email, password };
}

export default async function globalSetup(): Promise<void> {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  if (process.env.DOC_EMAIL && process.env.DOC_PASSWORD) {
    console.log(`Using DOC_EMAIL=${process.env.DOC_EMAIL}`);
    return;
  }

  if (fs.existsSync(CREDS_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8')) as { email: string; password: string };
      if (saved.email && saved.password) {
        process.env.DOC_EMAIL = saved.email;
        process.env.DOC_PASSWORD = saved.password;
        console.log(`Reusing saved demo credentials: ${saved.email}`);
        return;
      }
    } catch {
      // fall through to register
    }
  }

  console.log('Registering fresh demo tenant for partnership video...');
  const creds = await registerDemoUser();
  process.env.DOC_EMAIL = creds.email;
  process.env.DOC_PASSWORD = creds.password;
  fs.mkdirSync(path.dirname(CREDS_FILE), { recursive: true });
  fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), 'utf-8');
  console.log(`Demo user created: ${creds.email}`);
}
