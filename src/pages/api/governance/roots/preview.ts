import type { NextApiRequest, NextApiResponse } from 'next';
import { getApprovedRootPreviewService } from '@/lib/governance/approval-preview';
import { approvedRootPreviewApiBodySchema } from '@/lib/governance/api-schema';
import { authorizeRuntimeV2ApiRequest } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (process.env.AGENTMUX_RUNTIME_V2 !== '1') return sendRuntimeDisabled(res);
  const authorization = await authorizeRuntimeV2ApiRequest(req);
  if (!authorization.authorized) return res.status(authorization.statusCode).json({ error: authorization.reason });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const input = parseRuntimeApiBody(approvedRootPreviewApiBodySchema, req.body);
    return res.status(200).json(await getApprovedRootPreviewService().createPreview(input.path, input.label));
  } catch (error) {
    return sendRuntimeApiError(res, error);
  }
};

export default handler;
