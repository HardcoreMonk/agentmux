import type { NextApiRequest, NextApiResponse } from 'next';
import { registerManagedProjectApiBodySchema } from '@/lib/governance/api-schema';
import { resolveManagedProjectPath } from '@/lib/governance/project-path-policy';
import { authorizeRuntimeV2ApiRequest } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const degradedHealth = {
  state: 'degraded' as const,
  writeState: 'degraded' as const,
  indexedProjects: 0,
  lastIndexedAt: null,
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (process.env.AGENTMUX_RUNTIME_V2 !== '1') return sendRuntimeDisabled(res);
  const mutation = req.method === 'POST';
  const authorization = await authorizeRuntimeV2ApiRequest(req, mutation ? { mutation: true } : {});
  if (!authorization.authorized) return res.status(authorization.statusCode).json({ error: authorization.reason });
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    if (req.method === 'GET') {
      const [projects, roots] = await Promise.all([
        supervisor.listManagedProjects(),
        supervisor.listApprovedProjectRoots(),
      ]);
      const refresh = await supervisor.refreshGovernanceProjects(true).catch(() => null);
      const health = await supervisor.getGovernanceHealth().catch(() => degradedHealth);
      return res.status(200).json({ projects, roots, health, refresh });
    }
    const input = parseRuntimeApiBody(registerManagedProjectApiBodySchema, req.body);
    const roots = await supervisor.listApprovedProjectRootSnapshots();
    const root = roots.find((candidate) => candidate.id === input.approvedRootId);
    if (!root) throw Object.assign(new Error('Approved Project Root was not found.'), { code: 'approved-project-root-required' });
    const resolved = await resolveManagedProjectPath({
      approvedRootPath: root.canonicalPath,
      candidatePath: input.path,
    });
    const project = await supervisor.registerManagedProject({
      approvedRootId: root.id,
      title: input.title,
      relativePath: resolved.relativePath,
      canonicalPath: resolved.canonicalProjectPath,
      source: 'manual',
    });
    return res.status(201).json(project);
  } catch (error) {
    return sendRuntimeApiError(res, error);
  }
};

export default handler;
