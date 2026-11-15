import type { NextApiRequest, NextApiResponse } from 'next';
import { isCodexHookFingerprintTrusted } from '@/lib/codex-hook-trust';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(200).json({ trusted: await isCodexHookFingerprintTrusted() });
};

export default handler;
