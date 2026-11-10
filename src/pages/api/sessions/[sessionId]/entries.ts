import type { NextApiRequest, NextApiResponse } from 'next';
import { authorizeRuntimeV2ApiRequest } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { sessionEntriesApiQuerySchema } from '@/lib/session-catalog/api-schema';
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
    const query = parseRuntimeApiBody(sessionEntriesApiQuerySchema, req.query);
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    return res.status(200).json(await supervisor.readSessionCatalogEntries({
      sessionId: query.sessionId,
      beforeByte: query.beforeByte,
      limit: query.limit,
    }));
  } catch (error) {
    return sendRuntimeApiError(res, error);
  }
};

export default handler;
