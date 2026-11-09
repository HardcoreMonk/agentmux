import type { NextApiRequest, NextApiResponse } from 'next';
import { authorizeRuntimeV2ApiRequest } from '@/lib/runtime/api-auth';
import { sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
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
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    const result = await supervisor.rebuildSessionCatalog();
    return res.status(result.started ? 202 : 200).json(result);
  } catch (error) {
    return sendRuntimeApiError(res, error);
  }
};

export default handler;
