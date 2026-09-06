import vm from 'vm';
import { appShellHtml } from '../../web/app-html';

function meter(balance: number | null, id = 1) {
  return {
    id,
    label: `Meter ${id}`,
    meterNo: String(id),
    lowThreshold: 150,
    criticalThreshold: 100,
    balance,
    prediction: null,
    readings: [],
  };
}

async function dashboard(meters: ReturnType<typeof meter>[]) {
  const element = () => ({
    innerHTML: '',
    textContent: '',
    style: {},
    querySelectorAll: () => [],
    querySelector: () => null,
  });
  const elements = new Map<string, ReturnType<typeof element>>();
  const getElementById = (id: string) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id)!;
  };
  const html = appShellHtml('test-nonce', 'csrf');
  const code = /<script nonce="test-nonce">([\s\S]*?)<\/script>/.exec(html)![1];

  await new vm.Script(code).runInNewContext({
    document: { getElementById, querySelectorAll: () => [] },
    window: { addEventListener: () => undefined },
    location: { hash: '' },
    fetch: async () => ({
      ok: true,
      json: async () => ({ plan: 'free', meters, pausedMeters: [], alerts: [] }),
    }),
  });
  return getElementById('host').innerHTML;
}

describe('dashboard balances', () => {
  it('does not treat a missing reading as a healthy meter with zero credit', async () => {
    const html = await dashboard([meter(null)]);

    expect(html).toContain('Balance unavailable');
    expect(html).toContain('Total balance, 1 meter</div><div class="n">n/a');
    expect(html).toContain('1 unknown');
    expect(html).not.toContain('Every meter is healthy');
    expect(html).not.toContain('all steady');
  });

  it('labels an incomplete total as the balance of the meters it can read', async () => {
    const html = await dashboard([meter(500), meter(null, 2)]);

    expect(html).toContain('Known balance, 1 of 2 meters</div><div class="n">\u09F3500.00');
    expect(html).toContain('1 unknown');
    expect(html).not.toContain('Every meter is healthy');
  });

  it.each([
    { balance: 42.5, warning: 'one warm fridge from darkness' },
    { balance: 120, warning: 'is getting low' },
  ])(
    'keeps the alert banner for a balance of $balance when another meter is unknown',
    async ({ balance, warning }) => {
      const html = await dashboard([meter(balance), meter(null, 2)]);

      expect(html).toContain(warning);
      expect(html).toContain('1 unknown');
      expect(html).not.toContain('Every meter is healthy');
    }
  );

  it('keeps a real zero balance distinct from a missing reading', async () => {
    const html = await dashboard([meter(0)]);

    expect(html).toContain('Total balance, 1 meter</div><div class="n">\u09F30.00');
    expect(html).toContain('one warm fridge from darkness');
    expect(html).not.toContain('unknown');
  });

  it('reports a healthy total when every meter has a healthy reading', async () => {
    const html = await dashboard([meter(500), meter(250, 2)]);

    expect(html).toContain('Every meter is healthy');
    expect(html).toContain('Total balance, 2 meters</div><div class="n">\u09F3750.00');
    expect(html).not.toContain('unknown');
  });
});
