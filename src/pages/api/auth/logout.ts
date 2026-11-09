import type { NextApiRequest, NextApiResponse } from 'next';
import { buildClearCookieHeaders, isSecureRequest } from '@/lib/auth';

const handler = (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader('Set-Cookie', buildClearCookieHeaders(isSecureRequest(req)));
  return res.status(200).json({ ok: true });
};

export default handler;
