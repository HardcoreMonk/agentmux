import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock('@/lib/config-store', () => ({
  getConfig: mocks.getConfig,
  updateConfig: mocks.updateConfig,
  hashPassword: vi.fn(),
  generateSecret: vi.fn(),
}));
vi.mock('@/lib/access-filter', () => ({
  isBoundToLocalhostOnly: () => true,
  updateAccessFromConfig: vi.fn(),
}));

import handler from '@/pages/api/config';

const createResponse = () => {
  let statusCode = 0;
  let body: unknown;
  const res = {
    setHeader: vi.fn(),
    status: vi.fn((code: number) => { statusCode = code; return res; }),
    json: vi.fn((value: unknown) => { body = value; return res; }),
  } as unknown as NextApiResponse;
  return { res, get statusCode() { return statusCode; }, get body() { return body; } };
};

const patch = async (body: unknown) => {
  const response = createResponse();
  await handler({ method: 'PATCH', body, headers: {}, query: {} } as unknown as NextApiRequest, response.res);
  return response;
};

describe('config API Claude keys', () => {
  beforeEach(() => {
    mocks.getConfig.mockReset();
    mocks.updateConfig.mockReset();
    mocks.updateConfig.mockResolvedValue(undefined);
  });

  it.each([
    ['a dotted model name', { claudeModel: 'claude-sonnet-4.5' }],
    ['a model name with a colon', { claudeModel: 'opus:1m' }],
    ['a 128-character model name', { claudeModel: 'a'.repeat(128) }],
    ['a cleared model', { claudeModel: null }],
    ['the plan permission mode', { claudePermissionMode: 'plan' }],
    ['the bypassPermissions permission mode', { claudePermissionMode: 'bypassPermissions' }],
    ['a cleared permission mode', { claudePermissionMode: null }],
  ])('stores %s', async (_label, body) => {
    const response = await patch(body);
    expect(response.statusCode).toBe(200);
    expect(mocks.updateConfig).toHaveBeenCalledWith(body);
  });

  it.each([
    ['an empty model', { claudeModel: '' }],
    ['a 129-character model name', { claudeModel: 'a'.repeat(129) }],
    ['a model with shell characters', { claudeModel: 'sonnet; rm -rf ~' }],
    ['a model with a space', { claudeModel: 'model name' }],
    ['a non-string model', { claudeModel: 42 }],
    ['an unknown permission mode', { claudePermissionMode: 'default' }],
    ['a wrongly cased permission mode', { claudePermissionMode: 'Plan' }],
    ['a non-string permission mode', { claudePermissionMode: true }],
  ])('rejects %s', async (_label, body) => {
    const response = await patch(body);
    expect(response.statusCode).toBe(400);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });
});

describe('config API agentShowTerminal', () => {
  beforeEach(() => {
    mocks.getConfig.mockReset();
    mocks.updateConfig.mockReset();
    mocks.updateConfig.mockResolvedValue(undefined);
  });

  it.each([true, false])('stores boolean %s', async (value) => {
    const response = await patch({ agentShowTerminal: value });
    expect(response.statusCode).toBe(200);
    expect(mocks.updateConfig).toHaveBeenCalledWith({ agentShowTerminal: value });
  });

  it.each(['true', 1, null])('rejects non-boolean %s', async (value) => {
    const response = await patch({ agentShowTerminal: value });
    expect(response.statusCode).toBe(400);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });
});
