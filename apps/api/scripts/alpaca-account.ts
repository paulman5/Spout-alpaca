/**
 * Discover the sandbox trading account to use with the shared credentials.
 *   pnpm alpaca-account            -> lists accounts, prints the id to put in ALPACA_ACCOUNT_ID
 *   pnpm alpaca-account --create   -> creates a sandbox test account if none exists
 */
import { loadEnv } from '../src/config/env';
import { AlpacaBrokerClient } from '../src/broker/alpaca/alpaca-broker.client';
import { httpJson } from '../src/broker/http';

(async () => {
  const env = loadEnv();
  const client = new AlpacaBrokerClient({ ...env, BROKER: 'alpaca' });
  const token = await client.accessToken();
  const base = env.ALPACA_BASE_URL;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const accounts = (await httpJson(`${base}/v1/accounts`, { headers })).json<Array<{ id: string; account_number: string; status: string; created_at: string }>>();
  // eslint-disable-next-line no-console
  console.log(`accounts (${accounts.length}):`);
  for (const a of accounts) console.log(`  ${a.id}  ${a.account_number}  ${a.status}  ${a.created_at}`);

  if (process.argv.includes('--create')) {
    const suffix = Date.now().toString(36);
    const body = {
      contact: { email_address: `spout-takehome-${suffix}@example.com`, phone_number: '555-666-7788', street_address: ['20 N San Mateo Dr'], city: 'San Mateo', state: 'CA', postal_code: '94401', country: 'USA' },
      identity: { given_name: 'Ramy', family_name: 'Takehome', date_of_birth: '1990-01-01', tax_id: '666-55-4321', tax_id_type: 'USA_SSN', country_of_citizenship: 'USA', country_of_birth: 'USA', country_of_tax_residence: 'USA', funding_source: ['employment_income'] },
      disclosures: { is_control_person: false, is_affiliated_exchange_or_finra: false, is_politically_exposed: false, immediate_family_exposed: false },
      agreements: [
        { agreement: 'customer_agreement', signed_at: new Date().toISOString(), ip_address: '127.0.0.1' },
      ],
      enabled_assets: ['us_equity'],
    };
    const res = await httpJson(`${base}/v1/accounts`, { method: 'POST', headers, body: JSON.stringify(body) });
    console.log('created:', res.text);
  }

  const active = accounts.find((a) => a.status === 'ACTIVE') ?? accounts[0];
  if (active) {
    console.log(`\nALPACA_ACCOUNT_ID=${active.id}`);
    const acct = (await httpJson(`${base}/v1/trading/accounts/${active.id}/account`, { headers })).json<Record<string, unknown>>();
    console.log(`buying_power=${acct['buying_power']} cash=${acct['cash']} status=${acct['status']}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
