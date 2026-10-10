import type { ShoppingListItem } from '@contracts/models';

import { resetMockDb, SEED } from '../db';
import { mockRequest, mockTokenFor } from '../handler';

// Engine behavior through the mock API, the same path the screens use (DESIGN.md §6.3).

const gid = SEED.groupId;
const ian = mockTokenFor(SEED.users.ian);
const carson = mockTokenFor(SEED.users.carson);

const call = (method: string, path: string, body?: unknown, token = ian) => mockRequest(method, path, body, token) as Promise<any>;
const list = async (token = ian) => (await call('GET', `/groups/${gid}/shopping-list`, undefined, token)) as ShoppingListItem[];
const names = (rows: { item: { name: string } }[]) => rows.map((r) => r.item.name);

async function joinAsIan() {
  await call('POST', `/invites/${SEED.inviteId}/accept`);
}

beforeEach(() => {
  resetMockDb();
});

it('golden test: after accepting the invite the list is Lay\'s, Oreos, Tostitos', async () => {
  await joinAsIan();
  const rows = await list();
  expect(names(rows)).toEqual(["Lay's", 'Oreos', 'Tostitos']);

  // Oreos is still in the cabinet as running_low (the "Running low at home" chip).
  const cabinet = await call('GET', `/groups/${gid}/cabinet`);
  expect(cabinet.find((c: any) => c.item.name === 'Oreos').status).toBe('running_low');
  // Cheerios is in stock, so it is not on the list.
  expect(names(rows)).not.toContain('Cheerios');
});

it('wantedBy is the preference union', async () => {
  await joinAsIan();
  const lays = (await list()).find((r) => r.item.name === "Lay's")!;
  expect(lays.wantedBy).toEqual([SEED.users.carson, SEED.users.maya]);
  expect(lays.reason).toBe('preference');
});

it('non-members get 404 on group routes', async () => {
  await expect(list()).rejects.toMatchObject({ status: 404 });
});

it('finish trip moves checked rows to the cabinet as in stock', async () => {
  await joinAsIan();
  const rows = await list();
  for (const name of ["Lay's", 'Tostitos']) {
    const row = rows.find((r) => r.item.name === name)!;
    await call('PATCH', `/groups/${gid}/shopping-list/${row.id}`, { checked: true });
  }
  const res = await call('POST', `/groups/${gid}/shopping-list/complete`);
  expect(res).toEqual({ movedToCabinet: 2 });

  expect(names(await list())).toEqual(['Oreos']);
  const cabinet = await call('GET', `/groups/${gid}/cabinet`);
  const byName = Object.fromEntries(cabinet.map((c: any) => [c.item.name, c.status]));
  expect(byName).toMatchObject({ "Lay's": 'in_stock', Tostitos: 'in_stock', Cheerios: 'in_stock' });
});

it('a checked row survives regeneration', async () => {
  await joinAsIan();
  const lays = (await list()).find((r) => r.item.name === "Lay's")!;
  await call('PATCH', `/groups/${gid}/shopping-list/${lays.id}`, { checked: true });
  await call('POST', `/groups/${gid}/shopping-list/generate`);
  expect((await list()).find((r) => r.id === lays.id)?.checked).toBe(true);
});

it('ran out → requeued:true when someone wants the item', async () => {
  await joinAsIan();
  const cabinet = await call('GET', `/groups/${gid}/cabinet`);
  const cheerios = cabinet.find((c: any) => c.item.name === 'Cheerios');
  expect(await call('POST', `/groups/${gid}/cabinet/${cheerios.id}/ran-out`)).toEqual({ requeued: true });
  expect(names(await list())).toContain('Cheerios');
  expect(names(await call('GET', `/groups/${gid}/cabinet`))).not.toContain('Cheerios');
});

it('ran out → requeued:false when nobody wants it', async () => {
  await joinAsIan();
  const rice = await call('POST', `/groups/${gid}/cabinet`, { itemId: 'i-rice' });
  expect(await call('POST', `/groups/${gid}/cabinet/${rice.id}/ran-out`)).toEqual({ requeued: false });
  expect(names(await list())).not.toContain('Rice');
});

it('one_time preferences drop after they are bought; staples stay', async () => {
  await joinAsIan();
  await call('POST', `/groups/${gid}/preferences`, { itemId: 'i-milk', recurrence: 'one_time' });
  await call('POST', `/groups/${gid}/preferences`, { itemId: 'i-bread', recurrence: 'staple' });

  for (const row of (await list()).filter((r) => ['Milk', 'Bread'].includes(r.item.name))) {
    await call('PATCH', `/groups/${gid}/shopping-list/${row.id}`, { checked: true });
  }
  await call('POST', `/groups/${gid}/shopping-list/complete`);

  const mine = await call('GET', `/groups/${gid}/preferences?userId=me`);
  expect(names(mine)).toEqual(['Bread']);

  // Running out of milk no longer requeues it: nobody wants it anymore.
  const cabinet = await call('GET', `/groups/${gid}/cabinet`);
  const milk = cabinet.find((c: any) => c.item.name === 'Milk');
  expect(await call('POST', `/groups/${gid}/cabinet/${milk.id}/ran-out`)).toEqual({ requeued: false });
});

it('running low keeps the item in the cabinet and puts it on the list', async () => {
  await joinAsIan();
  const cabinet = await call('GET', `/groups/${gid}/cabinet`);
  const cheerios = cabinet.find((c: any) => c.item.name === 'Cheerios');
  await call('PATCH', `/groups/${gid}/cabinet/${cheerios.id}`, { status: 'running_low' });
  expect(names(await list())).toContain('Cheerios');
  expect(names(await call('GET', `/groups/${gid}/cabinet`))).toContain('Cheerios');
});

it('allergen flags cover every member and update with dietary changes', async () => {
  await joinAsIan();
  await call('POST', `/groups/${gid}/shopping-list`, { itemId: 'i-milk' });
  let milk = (await list()).find((r) => r.item.name === 'Milk')!;
  expect(milk.reason).toBe('manual');
  expect(milk.allergenFlags).toEqual([{ userId: SEED.users.maya, displayName: 'Maya', allergen: 'milk' }]);

  await call('PUT', '/me/dietary', { diets: [], allergens: ['milk'] });
  milk = (await list()).find((r) => r.item.name === 'Milk')!;
  expect(milk.allergenFlags.map((f) => f.userId)).toEqual([SEED.users.maya, SEED.users.ian]);
});

it('removing a preference drops its unchecked row', async () => {
  const prefs = await call('GET', `/groups/${gid}/preferences?userId=me`, undefined, carson);
  const lays = prefs.find((p: any) => p.item.name === "Lay's");
  await call('DELETE', `/groups/${gid}/preferences/${lays.id}`, undefined, carson);
  // Maya still wants Lay's.
  expect(names(await list(carson))).toContain("Lay's");

  const oreos = prefs.find((p: any) => p.item.name === 'Oreos');
  await call('DELETE', `/groups/${gid}/preferences/${oreos.id}`, undefined, carson);
  expect(names(await list(carson))).toContain('Oreos'); // Maya
});

it('confirming a suggestion saves an alias so the next search is exact', async () => {
  const first = await call('GET', '/items/search?q=cherios');
  expect(first.match).toBe('suggested');
  expect(first.results[0].name).toBe('Cheerios');

  await call('POST', '/items', { name: 'cherios', aliasOf: first.results[0].id });
  const second = await call('GET', '/items/search?q=cherios');
  expect(second).toMatchObject({ match: 'exact', results: [{ name: 'Cheerios' }] });
});
