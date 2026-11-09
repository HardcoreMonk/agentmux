import type { NextApiRequest, NextApiResponse } from 'next';
import { getApprovedRootPreviewService } from '@/lib/governance/approval-preview';
import { approvedRootConfirmApiBodySchema } from '@/lib/governance/api-schema';
import { authorizeRuntimeV2ApiRequest } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { createRuntimeId } from '@/lib/runtime/session-name';
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
    const input = parseRuntimeApiBody(approvedRootConfirmApiBodySchema, req.body);
    const approved = await getApprovedRootPreviewService().confirmPreview(input.token, input.digest);
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    const result = await supervisor.registerApprovedProjectRoot({
      id: createRuntimeId('root'),
      label: approved.label,
      canonicalPath: approved.canonicalPath,
      approvedAt: new Date().toISOString(),
    });
    return res.status(201).json(result);
  } catch (error) {
    return sendRuntimeApiError(res, error);
  }
};

export default handler;
