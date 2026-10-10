import { api, ApiError, setAuthHandlers } from '../client';

const fetchMock = jest.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  });
}

const onUnauthorized = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  onUnauthorized.mockReset();
  setAuthHandlers({ getToken: () => 'jwt-123', onUnauthorized });
});

it('sends the bearer token and JSON body, and returns parsed data', async () => {
  respond(200, { id: 'g1' });
  const data = await api<{ id: string }>('/groups', { method: 'POST', body: { name: 'House' } });

  expect(data).toEqual({ id: 'g1' });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/groups$/);
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer jwt-123');
  expect(init.headers['Content-Type']).toBe('application/json');
  expect(init.body).toBe(JSON.stringify({ name: 'House' }));
});

it('omits Authorization when signed out', async () => {
  setAuthHandlers({ getToken: () => null, onUnauthorized });
  respond(200, { ok: true });
  await api('/health');
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
});

it('turns the error envelope into an ApiError', async () => {
  respond(409, { error: { code: 'ALREADY_MEMBER', message: 'Already in this household' } });
  await expect(api('/groups/g1/invites', { method: 'POST', body: {} })).rejects.toMatchObject({
    name: 'ApiError',
    status: 409,
    code: 'ALREADY_MEMBER',
    message: 'Already in this household',
  });
});

it('clears the session on 401', async () => {
  respond(401, { error: { code: 'UNAUTHORIZED', message: 'Token expired' } });
  await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

it('returns undefined for 204', async () => {
  respond(204);
  await expect(api('/groups/g1', { method: 'DELETE' })).resolves.toBeUndefined();
});

it('reports network failures as NETWORK_ERROR', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await expect(api('/health')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
});
