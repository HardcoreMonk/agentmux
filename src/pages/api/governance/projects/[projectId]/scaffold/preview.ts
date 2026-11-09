import type { NextApiRequest, NextApiResponse } from 'next';
import {
  projectGovernanceApiQuerySchema,
  scaffoldPreviewApiBodySchema,
} from '@/lib/governance/api-schema';
import { authorizeRuntimeV2ApiRequest } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (process.env.AGENTMUX_RUNTIME_V2 !== '1') return sendRuntimeDisabled(res);
  const authorization = await authorizeRuntimeV2ApiRequest(req, { mutation: true });
  if (!authorization.authorized) return res.status(authorization.statusCode).json({ error: authorization.reason });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { projectId } = parseRuntimeApiBody(projectGovernanceApiQuerySchema, req.query);
    const input = parseRuntimeApiBody(scaffoldPreviewApiBodySchema, req.body);
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    await supervisor.refreshGovernanceProjects();
    return res.status(200).json(await supervisor.previewGovernanceScaffold({ projectId, ...input }));
  } catch (error) {
    return sendRuntimeApiError(res, error);
  }
};

export default handler;
