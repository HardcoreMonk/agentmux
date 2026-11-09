import type { NextApiRequest, NextApiResponse } from 'next';
import { projectImportConfirmApiBodySchema } from '@/lib/governance/api-schema';
import {
  getProjectImportPreviewService,
  rememberApprovedProjectRoots,
} from '@/lib/governance/import-preview';
import { readProjectsYamlImportSource } from '@/lib/governance/import-source';
import { authorizeRuntimeV2ApiRequest } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const previewFailure = (reason: string): Error => Object.assign(
  new Error('Project import preview is no longer valid.'),
  { code: `project-import-preview-${reason}`, retryable: false },
);

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (process.env.AGENTMUX_RUNTIME_V2 !== '1') return sendRuntimeDisabled(res);
  const authorization = await authorizeRuntimeV2ApiRequest(req, { mutation: true });
  if (!authorization.authorized) return res.status(authorization.statusCode).json({ error: authorization.reason });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const input = parseRuntimeApiBody(projectImportConfirmApiBodySchema, req.body);
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    const roots = await supervisor.listApprovedProjectRootSnapshots();
    rememberApprovedProjectRoots(roots.map((root) => root.id));
    const root = roots.find((candidate) => candidate.id === input.approvedRootId);
    if (!root) throw Object.assign(new Error('Approved Project Root was not found.'), { code: 'approved-project-root-required' });
    const source = await readProjectsYamlImportSource(root);
    const preview = getProjectImportPreviewService().confirmPreview({
      token: input.token,
      approvedRootId: input.approvedRootId,
      sourceContent: source.sourceContent,
    });
    if (!preview.confirmed) throw previewFailure(preview.reason);
    if (preview.digest !== input.digest || preview.sourceFingerprint !== input.sourceFingerprint) {
      throw previewFailure('mismatch');
    }
    const canonicalByExternalId = new Map(source.candidates.map((candidate) => [candidate.externalId, candidate.canonicalPath]));
    const selections = new Map(input.selections.map((selection) => [selection.externalId, selection.selectedFields]));
    const actions = preview.actions.map((action) => {
      const canonicalPath = canonicalByExternalId.get(action.externalId);
      if (!canonicalPath) throw previewFailure('source-changed');
      return {
        ...action,
        canonicalPath,
        selectedFields: selections.get(action.externalId) ?? [],
      };
    });
    const result = await supervisor.applyManagedProjectImport({
      approvedRootId: input.approvedRootId,
      digest: preview.digest,
      sourceFingerprint: preview.sourceFingerprint,
      actions,
    });
    return res.status(200).json(result);
  } catch (error) {
    return sendRuntimeApiError(res, error);
  }
};

export default handler;
