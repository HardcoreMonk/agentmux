import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyRuntimeV2ApiAuth } from '@/lib/runtime/api-auth';
import { sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { DEFAULT_AGENT_PANEL_TYPE, normalizePanelType, parseAgentPanelTypeList } from '@/lib/panel-type';
import type { TPanelType } from '@/types/terminal';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const firstQueryValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const parseBoundedInteger = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const parsePanelType = (value: string | string[] | undefined): TPanelType =>
  normalizePanelType(firstQueryValue(value)) ?? DEFAULT_AGENT_PANEL_TYPE;

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (process.env.AGENTMUX_RUNTIME_V2 !== '1') {
    return sendRuntimeDisabled(res);
  }

  if (!(await verifyRuntimeV2ApiAuth(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tmuxSession = firstQueryValue(req.query.tmuxSession);
  if (!tmuxSession) {
    return res.status(400).json({ error: 'missing-param', message: 'tmuxSession parameter required' });
  }

  try {
    const supervisor = getRuntimeSupervisor();
    const providers = parseAgentPanelTypeList(req.query.providers);
    const page = await supervisor.listTimelineSessions({
      tmuxSession,
      cwd: firstQueryValue(req.query.cwd),
      panelType: parsePanelType(req.query.panelType),
      offset: parseBoundedInteger(firstQueryValue(req.query.offset), 0, 0, Number.MAX_SAFE_INTEGER),
      limit: parseBoundedInteger(firstQueryValue(req.query.limit), DEFAULT_LIMIT, 1, MAX_LIMIT),
      ...(providers ? { providers } : {}),
    });
    return res.status(200).json(page);
  } catch (err) {
    return sendRuntimeApiError(res, err);
  }
};

export default handler;
