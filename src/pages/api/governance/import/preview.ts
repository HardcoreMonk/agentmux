import type { NextApiRequest, NextApiResponse } from 'next';
import { projectImportPreviewApiBodySchema } from '@/lib/governance/api-schema';
import {
  getProjectImportPreviewService,
  rememberApprovedProjectRoots,
} from '@/lib/governance/import-preview';
import { readProjectsYamlImportSource } from '@/lib/governance/import-source';
import { authorizeRuntimeV2ApiRequest } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (process.env.AGENTMUX_RUNTIME_V2 !== '1') return sendRuntimeDisabled(res);
  const authorization = await authorizeRuntimeV2ApiRequest(req);
  if (!authorization.authorized) return res.status(authorization.statusCode).json({ error: authorization.reason });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const input = parseRuntimeApiBody(projectImportPreviewApiBodySchema, req.body);
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    const roots = await supervisor.listApprovedProjectRootSnapshots();
    rememberApprovedProjectRoots(roots.map((root) => root.id));
    const root = roots.find((candidate) => candidate.id === input.approvedRootId);
    if (!root) throw Object.assign(new Error('Approved Project Root was not found.'), { code: 'approved-project-root-required' });
    const [{ sourceContent, candidates }, existing] = await Promise.all([
      readProjectsYamlImportSource(root),
      supervisor.listManagedProjectSnapshots(),
    ]);
    const preview = getProjectImportPreviewService().createPreview({
      approvedRootId: root.id,
      sourceContent,
      candidates: candidates.map(({ canonicalPath: _canonicalPath, ...candidate }) => candidate),
      existingProjects: existing
        .filter((project): project is typeof project & { externalId: string } => Boolean(project.externalId))
        .map((project) => ({
          id: project.id,
          externalId: project.externalId,
          title: project.title,
          relativePath: project.relativePath,
        })),
    });
    return res.status(200).json(preview);
  } catch (error) {
    return sendRuntimeApiError(res, error);
  }
};

export default handler;
