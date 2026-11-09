import type { NextApiRequest, NextApiResponse } from 'next';
import { projectDocumentsApiQuerySchema } from '@/lib/governance/api-schema';
import { authorizeRuntimeV2ApiRequest } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (process.env.AGENTMUX_RUNTIME_V2 !== '1') return sendRuntimeDisabled(res);
  const authorization = await authorizeRuntimeV2ApiRequest(req);
  if (!authorization.authorized) return res.status(authorization.statusCode).json({ error: authorization.reason });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const input = parseRuntimeApiBody(projectDocumentsApiQuerySchema, req.query);
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    await supervisor.refreshGovernanceProjects();
    if (input.path) {
      return res.status(200).json(await supervisor.readProjectDocument(input.projectId, input.path));
    }
    return res.status(200).json({ documents: await supervisor.listProjectDocuments(input.projectId) });
  } catch (error) {
    return sendRuntimeApiError(res, error);
  }
};

export default handler;
