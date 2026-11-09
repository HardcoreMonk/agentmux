import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataDir, prepareDataDir } from '@/lib/app-identity';
import { createRuntimeCommand, runtimeCommandRegistry } from '@/lib/runtime/ipc';
import { createGovernanceWorkerService } from '@/lib/runtime/governance/worker-service';

describe('governance worker service', () => {
  let dir: string;
  let service: ReturnType<typeof createGovernanceWorkerService>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-governance-worker-'));
    const projectRoot = path.join(dir, 'project');
    await fs.mkdir(path.join(projectRoot, 'docs', 'superpowers', 'specs'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'AGENTS.md'), '# Guidance\n');
    await fs.writeFile(path.join(projectRoot, 'docs', 'superpowers', 'specs', 'feature.md'), '# Feature\n');
    service = createGovernanceWorkerService({ indexPath: path.join(dir, 'index.db') });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    service?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('refreshes Storage-provided snapshots and serves bounded read models', async () => {
    const snapshot = {
      id: 'project-1', approvedRootId: 'root-1', title: 'Demo', relativePath: 'project',
      canonicalPath: path.join(dir, 'project'), source: 'manual' as const,
      createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z',
    };
    const refresh = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.refresh-projects', payload: { projects: [snapshot] },
    }));
    const summary = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.get-project-summary', payload: { projectId: 'project-1' },
    }));
    const documents = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.list-project-documents', payload: { projectId: 'project-1' },
    }));

    expect(refresh).toMatchObject({ ok: true, payload: { refreshed: 1, failed: 0 } });
    expect(summary).toMatchObject({
      ok: true,
      payload: { project: { id: 'project-1' }, engine: 'linux-single-host', readOnly: true, documentCount: 2 },
    });
    expect(documents).toMatchObject({ ok: true, payload: [
      { path: 'AGENTS.md', kind: 'agents' },
      { path: 'docs/superpowers/specs/feature.md', kind: 'spec' },
    ] });
  });

  it('keeps project filesystem mutation commands out of the registry', () => {
    const names = Object.keys(runtimeCommandRegistry);
    expect(names).toContain('governance.refresh-projects');
    expect(names).toContain('governance.preview-scaffold');
    expect(names.some((name) => /^governance\.(?:write|delete|move|sync)/.test(name))).toBe(false);
  });

  it('fails closed when writes are disabled', async () => {
    const health = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.health', payload: {},
    }));
    const preview = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.preview-scaffold',
      payload: {
        projectId: 'project-1', artifacts: ['context'],
        input: { title: 'Demo', summary: 'Summary', uiProject: false },
      },
    }));
    expect(health).toMatchObject({ ok: true, payload: { writeState: 'disabled' } });
    expect(preview).toMatchObject({ ok: false, error: { code: 'governance-writes-disabled' } });
  });

  it('previews, confirms, lists and rolls back a governed scaffold action', async () => {
    service.close();
    service = createGovernanceWorkerService({
      indexPath: path.join(dir, 'write-index.db'),
      backupRoot: path.join(dir, 'backups'),
      writesEnabled: true,
      readMountInfo: async () => '',
    });
    const projectRoot = path.join(dir, 'project');
    const root = {
      id: 'root-1', label: 'Projects', canonicalPath: dir, approvedAt: '2026-08-21T10:00:00.000Z',
    };
    const project = {
      id: 'project-1', approvedRootId: 'root-1', title: 'Demo', relativePath: 'project',
      canonicalPath: projectRoot, source: 'manual' as const,
      createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z',
    };
    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.refresh-projects',
      payload: { projects: [project], roots: [root] },
    }));
    const preview = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.preview-scaffold',
      payload: {
        projectId: 'project-1', artifacts: ['agents', 'context'],
        input: { title: 'Demo', summary: 'Summary', uiProject: false },
      },
    }));
    expect(preview).toMatchObject({
      ok: true,
      payload: {
        projectId: 'project-1',
        artifacts: expect.arrayContaining([expect.objectContaining({ id: 'agents', state: 'adoption-available' })]),
      },
    });
    const previewPayload = preview.payload as { token: string; digest: string };
    const ineligible = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.confirm-scaffold',
      payload: {
        projectId: 'project-1', token: previewPayload.token, digest: previewPayload.digest, confirmation: 'Demo',
      },
    }));
    expect(ineligible).toMatchObject({ ok: false, error: { code: 'scaffold-adoption-selection-required' } });

    const adoptionPreview = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.preview-scaffold',
      payload: {
        projectId: 'project-1', artifacts: ['agents', 'context'], adoptArtifacts: ['agents'],
        input: { title: 'Demo', summary: 'Summary', uiProject: false },
      },
    }));
    expect(adoptionPreview).toMatchObject({
      ok: true,
      payload: {
        artifacts: expect.arrayContaining([expect.objectContaining({ id: 'agents', state: 'adopt' })]),
      },
    });
    const adoptionPayload = adoptionPreview.payload as { token: string; digest: string };
    const confirmed = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.confirm-scaffold',
      payload: {
        projectId: 'project-1', token: adoptionPayload.token, digest: adoptionPayload.digest, confirmation: 'Demo',
      },
    }));
    expect(confirmed).toMatchObject({ ok: true, payload: { state: 'committed' } });
    expect(await fs.readFile(path.join(projectRoot, 'CONTEXT.md'), 'utf8')).toContain('BEGIN CODEXMUX');
    expect(await fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toMatch(
      /^# Guidance\n\n<!-- BEGIN CODEXMUX:project-agents-adopted:v1 -->/,
    );

    const actions = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.list-actions',
      payload: { projectId: 'project-1' },
    }));
    const actionId = (actions.payload as Array<{ id: string }>)[0]!.id;
    const rollbackPreview = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.preview-action-rollback',
      payload: { projectId: 'project-1', actionId },
    }));
    const rollbackPayload = rollbackPreview.payload as { token: string; digest: string };
    const rolledBack = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.confirm-action-rollback',
      payload: {
        projectId: 'project-1', actionId, token: rollbackPayload.token,
        digest: rollbackPayload.digest, confirmation: 'Demo',
      },
    }));
    expect(rolledBack).toMatchObject({ ok: true, payload: { state: 'rolled-back' } });
    await expect(fs.access(path.join(projectRoot, 'CONTEXT.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toBe('# Guidance\n');
  });

  it('revalidates indexed documents against binary and symlink changes before detail reads', async () => {
    const projectRoot = path.join(dir, 'project');
    const snapshot = {
      id: 'project-1', approvedRootId: 'root-1', title: 'Demo', relativePath: 'project',
      canonicalPath: projectRoot, source: 'manual' as const,
      createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z',
    };
    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.refresh-projects', payload: { projects: [snapshot] },
    }));
    await fs.writeFile(path.join(projectRoot, 'AGENTS.md'), Buffer.from([0, 1, 2]));
    const binary = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.read-project-document',
      payload: { projectId: 'project-1', path: 'AGENTS.md' },
    }));
    expect(binary).toMatchObject({ ok: false, error: { code: 'project-document-binary' } });

    await fs.rm(path.join(projectRoot, 'AGENTS.md'));
    await fs.symlink(path.join(projectRoot, 'docs', 'superpowers', 'specs', 'feature.md'), path.join(projectRoot, 'AGENTS.md'));
    const linked = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.read-project-document',
      payload: { projectId: 'project-1', path: 'AGENTS.md' },
    }));
    expect(linked).toMatchObject({ ok: false, error: { code: 'project-document-not-regular' } });
  });

  it('keeps writeState ready when aliased HOME has pre-rename action.json with real .codexmux preimagePath', async () => {
    service.close();
    const homeDir = path.join(dir, 'home-legacy-gov');
    const legacyDataDir = path.join(homeDir, '.codexmux');
    await fs.mkdir(legacyDataDir, { recursive: true });
    prepareDataDir({ homeDir, env: {} });
    vi.stubEnv('HOME', homeDir);
    vi.stubEnv('AGENTMUX_DATA_DIR', '');
    vi.stubEnv('CODEXMUX_DATA_DIR', '');

    const backupRoot = path.join(getDataDir(), 'backups', 'governance-actions');
    const actionDir = path.join(backupRoot, 'project-1', 'action-legacy-1');
    const preimageDir = path.join(actionDir, 'preimage');
    await fs.mkdir(preimageDir, { recursive: true });
    const preimagePath = path.join(preimageDir, 'agents.md');
    await fs.writeFile(preimagePath, '# Legacy Agents\n', 'utf8');

    const projectRoot = path.join(dir, 'project');
    await fs.writeFile(
      path.join(actionDir, 'action.json'),
      JSON.stringify({
        version: 1,
        id: 'action-legacy-1',
        projectId: 'project-1',
        projectTitle: 'Demo',
        canonicalProjectPath: projectRoot,
        state: 'committed',
        artifacts: [
          {
            id: 'agents',
            path: 'AGENTS.md',
            absolutePath: path.join(projectRoot, 'AGENTS.md'),
            state: 'marker-update',
            templateId: 'project-agents-adopted',
            fromVersion: null,
            toVersion: 1,
            baseFingerprint: `sha256:${'a'.repeat(64)}`,
            outputFingerprint: `sha256:${'b'.repeat(64)}`,
            preimagePath,
            stagePath: path.join(projectRoot, '.codexmux-stage-action-legacy-1-agents'),
            targetMode: 0o644,
            published: true,
          },
        ],
        createdDirectories: [],
        createdAt: '2026-08-21T10:00:00.000Z',
        updatedAt: '2026-08-21T10:00:01.000Z',
        errorCode: null,
        indexState: 'ready',
      }),
      'utf8',
    );

    service = createGovernanceWorkerService({
      indexPath: path.join(getDataDir(), 'governance', 'index.db'),
      backupRoot,
      writesEnabled: true,
      readMountInfo: async () => '',
    });
    await service.initialize();

    const health = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor', target: 'governance', type: 'governance.health', payload: {},
    }));
    expect(health).toMatchObject({
      ok: true,
      payload: {
        writeState: 'ready',
      },
    });
  });
});
