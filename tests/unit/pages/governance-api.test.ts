import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const supervisor = {
    ensureStarted: vi.fn(),
    registerApprovedProjectRoot: vi.fn(),
    listApprovedProjectRoots: vi.fn(),
    listApprovedProjectRootSnapshots: vi.fn(),
    registerManagedProject: vi.fn(),
    listManagedProjects: vi.fn(),
    listManagedProjectSnapshots: vi.fn(),
    applyManagedProjectImport: vi.fn(),
    refreshGovernanceProjects: vi.fn(),
    getGovernanceHealth: vi.fn(),
    getProjectGovernanceSummary: vi.fn(),
    listProjectDocuments: vi.fn(),
    getProjectLifecycle: vi.fn(),
    listProjectAuditCandidates: vi.fn(),
    readProjectDocument: vi.fn(),
    previewGovernanceScaffold: vi.fn(),
    confirmGovernanceScaffold: vi.fn(),
    listGovernanceActions: vi.fn(),
    previewGovernanceActionRollback: vi.fn(),
    confirmGovernanceActionRollback: vi.fn(),
  };
  return { auth: vi.fn(), supervisor, getRuntimeSupervisor: vi.fn(() => supervisor) };
});

vi.mock('@/lib/runtime/api-auth', () => ({ authorizeRuntimeV2ApiRequest: mocks.auth }));
vi.mock('@/lib/runtime/supervisor', () => ({ getRuntimeSupervisor: mocks.getRuntimeSupervisor }));

import rootPreviewHandler from '@/pages/api/governance/roots/preview';
import rootConfirmHandler from '@/pages/api/governance/roots/confirm';
import importPreviewHandler from '@/pages/api/governance/import/preview';
import importConfirmHandler from '@/pages/api/governance/import/confirm';
import projectsHandler from '@/pages/api/governance/projects/index';
import summaryHandler from '@/pages/api/governance/projects/[projectId]/summary';
import documentsHandler from '@/pages/api/governance/projects/[projectId]/documents';
import lifecycleHandler from '@/pages/api/governance/projects/[projectId]/lifecycle';
import auditHandler from '@/pages/api/governance/projects/[projectId]/audit';
import scaffoldPreviewHandler from '@/pages/api/governance/projects/[projectId]/scaffold/preview';
import scaffoldConfirmHandler from '@/pages/api/governance/projects/[projectId]/scaffold/confirm';
import actionsHandler from '@/pages/api/governance/projects/[projectId]/actions/index';
import rollbackPreviewHandler from '@/pages/api/governance/projects/[projectId]/actions/[actionId]/rollback/preview';
import rollbackConfirmHandler from '@/pages/api/governance/projects/[projectId]/actions/[actionId]/rollback/confirm';

const createResponse = () => {
  let statusCode = 0;
  let body: unknown;
  const response = {
    setHeader: vi.fn(() => response),
    status: vi.fn((code: number) => {
      statusCode = code;
      return response;
    }),
    json: vi.fn((value: unknown) => {
      body = value;
      return response;
    }),
  } as unknown as NextApiResponse;
  return { response, get statusCode() { return statusCode; }, get body() { return body; } };
};

const createRequest = ({ method = 'GET', query = {}, body }: {
  method?: string;
  query?: Record<string, string | string[]>;
  body?: unknown;
} = {}): NextApiRequest => ({
  method,
  query,
  body,
  url: '/api/governance/test',
  headers: {},
  rawHeaders: ['Host', 'localhost:8122'],
}) as unknown as NextApiRequest;

describe('governance API', () => {
  let root: string;

  beforeEach(async () => {
    process.env.AGENTMUX_RUNTIME_V2 = '1';
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-governance-api-'));
    await fs.mkdir(path.join(root, 'demo'), { recursive: true });
    await fs.writeFile(path.join(root, 'projects.yaml'), [
      'projects:',
      '  - id: demo',
      '    title: Demo',
      `    path: ${path.join(root, 'demo')}`,
      '',
    ].join('\n'));
    mocks.auth.mockReset().mockResolvedValue({ authorized: true, credential: { kind: 'session' } });
    Object.values(mocks.supervisor).forEach((mock) => mock.mockReset());
    mocks.supervisor.ensureStarted.mockResolvedValue(undefined);
    mocks.supervisor.registerApprovedProjectRoot.mockImplementation(async (input) => {
      const { canonicalPath: _canonicalPath, ...result } = input;
      return result;
    });
    mocks.supervisor.listApprovedProjectRootSnapshots.mockResolvedValue([{
      id: 'root-1', label: 'Projects', canonicalPath: root, approvedAt: '2026-08-21T10:00:00.000Z',
    }]);
    mocks.supervisor.listApprovedProjectRoots.mockResolvedValue([{
      id: 'root-1', label: 'Projects', approvedAt: '2026-08-21T10:00:00.000Z',
    }]);
    mocks.supervisor.listManagedProjects.mockResolvedValue([]);
    mocks.supervisor.listManagedProjectSnapshots.mockResolvedValue([]);
    mocks.supervisor.applyManagedProjectImport.mockResolvedValue({
      counts: { add: 1, update: 0, conflict: 0, unchanged: 0 },
    });
    mocks.supervisor.refreshGovernanceProjects.mockResolvedValue({ refreshed: 1, failed: 0 });
    mocks.supervisor.getGovernanceHealth.mockResolvedValue({
      state: 'ready', writeState: 'disabled', indexedProjects: 1, lastIndexedAt: null,
    });
    mocks.supervisor.getProjectGovernanceSummary.mockResolvedValue({
      project: {
        id: 'project-1', approvedRootId: 'root-1', title: 'Demo', relativePath: 'demo', source: 'manual',
        createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z',
      },
      engine: 'linux-single-host', readOnly: true, documentCount: 2, warningCount: 0,
      lifecycleStage: 'implement', indexState: 'ready', indexedAt: null,
    });
    mocks.supervisor.listProjectDocuments.mockResolvedValue([]);
    mocks.supervisor.getProjectLifecycle.mockResolvedValue({
      projectId: 'project-1', stage: 'implement', evidence: [],
      lint: { projectId: 'project-1', valid: true, errors: [], warnings: [] },
    });
    mocks.supervisor.listProjectAuditCandidates.mockResolvedValue([]);
    mocks.supervisor.readProjectDocument.mockResolvedValue({
      projectId: 'project-1', path: 'AGENTS.md', markdown: '# Guidance', truncated: false,
      fingerprint: `sha256:${'a'.repeat(64)}`,
    });
    mocks.supervisor.previewGovernanceScaffold.mockResolvedValue({
      token: 'a'.repeat(32), digest: `sha256:${'a'.repeat(64)}`, projectId: 'project-1',
      projectTitle: 'Demo', expiresAt: Date.now() + 60_000, artifacts: [], totalBytes: 0,
    });
    mocks.supervisor.confirmGovernanceScaffold.mockResolvedValue({
      id: 'action-1', projectId: 'project-1', state: 'committed', artifactCount: 1,
      createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z',
      errorCode: null, indexState: 'ready',
    });
    mocks.supervisor.listGovernanceActions.mockResolvedValue([]);
    mocks.supervisor.previewGovernanceActionRollback.mockResolvedValue({
      token: 'b'.repeat(32), digest: `sha256:${'b'.repeat(64)}`, expiresAt: Date.now() + 60_000,
      projectId: 'project-1', projectTitle: 'Demo', artifacts: [],
      action: {
        id: 'action-1', projectId: 'project-1', state: 'committed', artifactCount: 1,
        createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z',
        errorCode: null, indexState: 'ready',
      },
    });
    mocks.supervisor.confirmGovernanceActionRollback.mockResolvedValue({
      id: 'action-1', projectId: 'project-1', state: 'rolled-back', artifactCount: 1,
      createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z',
      errorCode: null, indexState: 'ready',
    });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('requires preview, digest, and exact confirmation before approving a root', async () => {
    const preview = createResponse();
    await rootPreviewHandler(createRequest({ method: 'POST', body: { path: root, label: 'Projects' } }), preview.response);
    expect(preview.statusCode).toBe(200);
    expect(JSON.stringify(preview.body)).not.toContain(root);

    const value = preview.body as { token: string; digest: string };
    const rejected = createResponse();
    await rootConfirmHandler(createRequest({
      method: 'POST', body: { token: value.token, digest: value.digest, confirmation: 'approve' },
    }), rejected.response);
    expect(rejected.statusCode).toBe(400);

    const confirmed = createResponse();
    await rootConfirmHandler(createRequest({
      method: 'POST', body: { token: value.token, digest: value.digest, confirmation: 'APPROVE PROJECT ROOT' },
    }), confirmed.response);
    expect(confirmed.statusCode).toBe(201);
    expect(mocks.auth).toHaveBeenLastCalledWith(expect.anything(), { mutation: true });
    expect(mocks.supervisor.registerApprovedProjectRoot).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Projects', canonicalPath: root,
    }));
  });

  it('imports projects.yaml through a fingerprinted preview without returning absolute paths', async () => {
    const preview = createResponse();
    await importPreviewHandler(createRequest({ method: 'POST', body: { approvedRootId: 'root-1' } }), preview.response);
    expect(preview.statusCode).toBe(200);
    expect(JSON.stringify(preview.body)).not.toContain(root);
    const value = preview.body as { token: string; digest: string; sourceFingerprint: string };

    const confirmed = createResponse();
    await importConfirmHandler(createRequest({
      method: 'POST',
      body: {
        approvedRootId: 'root-1', token: value.token, digest: value.digest,
        sourceFingerprint: value.sourceFingerprint, confirmation: 'IMPORT PROJECTS',
        selections: [{ externalId: 'demo', selectedFields: ['title', 'relativePath'] }],
      },
    }), confirmed.response);
    expect(confirmed.statusCode).toBe(200);
    expect(mocks.supervisor.applyManagedProjectImport).toHaveBeenCalledWith(expect.objectContaining({
      approvedRootId: 'root-1', digest: value.digest, sourceFingerprint: value.sourceFingerprint,
    }));
  });

  it('serves project-id based bounded read models through the Supervisor', async () => {
    const handlers = [summaryHandler, documentsHandler, lifecycleHandler, auditHandler];
    for (const handler of handlers) {
      const result = createResponse();
      await handler(createRequest({ query: { projectId: 'project-1' } }), result.response);
      expect(result.statusCode).toBe(200);
    }
    const detail = createResponse();
    await documentsHandler(createRequest({ query: { projectId: 'project-1', path: 'AGENTS.md' } }), detail.response);
    expect(detail.statusCode).toBe(200);
    expect(mocks.supervisor.readProjectDocument).toHaveBeenCalledWith('project-1', 'AGENTS.md');
    expect(mocks.supervisor.refreshGovernanceProjects).toHaveBeenCalled();
  });

  it('lists projects with degraded health and requires same-authority auth for catalog mutations', async () => {
    mocks.supervisor.refreshGovernanceProjects.mockRejectedValueOnce(Object.assign(new Error('unavailable'), {
      code: 'governance-worker-unavailable', retryable: true,
    }));
    mocks.supervisor.getGovernanceHealth.mockRejectedValueOnce(new Error('unavailable'));
    const list = createResponse();
    await projectsHandler(createRequest(), list.response);
    expect(list.statusCode).toBe(200);
    expect(list.body).toMatchObject({ health: { state: 'degraded' } });

    const create = createResponse();
    mocks.supervisor.registerManagedProject.mockResolvedValue({ id: 'project-1' });
    await projectsHandler(createRequest({
      method: 'POST', body: { approvedRootId: 'root-1', title: 'Demo', path: path.join(root, 'demo') },
    }), create.response);
    expect(create.statusCode).toBe(201);
    expect(mocks.auth).toHaveBeenLastCalledWith(expect.anything(), { mutation: true });
  });

  it('serves sanitized scaffold and rollback preview-confirm APIs', async () => {
    const scaffoldPreview = createResponse();
    await scaffoldPreviewHandler(createRequest({
      method: 'POST', query: { projectId: 'project-1' },
      body: {
        artifacts: ['context'],
        input: { title: 'Demo', summary: 'Summary', uiProject: false },
      },
    }), scaffoldPreview.response);
    expect(scaffoldPreview.statusCode).toBe(200);
    expect(mocks.supervisor.previewGovernanceScaffold).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', artifacts: ['context'], adoptArtifacts: [],
    }));

    const scaffoldConfirm = createResponse();
    await scaffoldConfirmHandler(createRequest({
      method: 'POST', query: { projectId: 'project-1' },
      body: { token: 'a'.repeat(32), digest: `sha256:${'a'.repeat(64)}`, confirmation: 'Demo' },
    }), scaffoldConfirm.response);
    expect(scaffoldConfirm.statusCode).toBe(200);

    const actions = createResponse();
    await actionsHandler(createRequest({ query: { projectId: 'project-1' } }), actions.response);
    expect(actions.statusCode).toBe(200);

    const rollbackPreview = createResponse();
    await rollbackPreviewHandler(createRequest({
      method: 'POST', query: { projectId: 'project-1', actionId: 'action-1' }, body: {},
    }), rollbackPreview.response);
    expect(rollbackPreview.statusCode).toBe(200);

    const rollbackConfirm = createResponse();
    await rollbackConfirmHandler(createRequest({
      method: 'POST', query: { projectId: 'project-1', actionId: 'action-1' },
      body: { token: 'b'.repeat(32), digest: `sha256:${'b'.repeat(64)}`, confirmation: 'Demo' },
    }), rollbackConfirm.response);
    expect(rollbackConfirm.statusCode).toBe(200);
    expect(mocks.auth).toHaveBeenLastCalledWith(expect.anything(), { mutation: true });
    expect(JSON.stringify([scaffoldConfirm.body, actions.body, rollbackConfirm.body])).not.toContain(root);
  });

  it('rejects arbitrary scaffold paths before the Supervisor boundary', async () => {
    const response = createResponse();
    await scaffoldPreviewHandler(createRequest({
      method: 'POST', query: { projectId: 'project-1' },
      body: {
        artifacts: ['context'], path: '../../outside',
        input: { title: 'Demo', summary: 'Summary', uiProject: false },
      },
    }), response.response);
    expect(response.statusCode).toBe(400);
    expect(mocks.supervisor.previewGovernanceScaffold).not.toHaveBeenCalled();
  });

  it('rejects an adoption selection outside the selected artifacts', async () => {
    const response = createResponse();
    await scaffoldPreviewHandler(createRequest({
      method: 'POST', query: { projectId: 'project-1' },
      body: {
        artifacts: ['agents'], adoptArtifacts: ['context'],
        input: { title: 'Demo', summary: 'Summary', uiProject: false },
      },
    }), response.response);
    expect(response.statusCode).toBe(400);
    expect(mocks.supervisor.previewGovernanceScaffold).not.toHaveBeenCalled();
  });
});
