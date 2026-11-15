import { buildApprovalPushBody, getApprovalMetadataDetail } from '@/lib/approval-queue';
import type { IStatusWebPushPayload } from '@/lib/runtime/status/web-push-actions';
import type { ITabStatusEntry } from '@/types/status';

export type TStatusWebPushType =
  | 'review'
  | 'needs-input'
  | 'agent-report-paused'
  | 'agent-report-expired';

interface IBuildStatusWebPushPayloadInput {
  tabId: string;
  entry: Pick<
    ITabStatusEntry,
    | 'workspaceId'
    | 'tabName'
    | 'lastUserMessage'
    | 'agentSessionId'
    | 'approvalPromptMetadata'
    | 'agentReportNotice'
  >;
  pushType: TStatusWebPushType;
  workspaceName: string;
  workspaceDir: string | null;
  soundOnCompleteEnabled?: boolean;
}

export const buildStatusWebPushPayload = ({
  tabId,
  entry,
  pushType,
  workspaceName,
  workspaceDir,
  soundOnCompleteEnabled,
}: IBuildStatusWebPushPayloadInput): IStatusWebPushPayload => {
  const tabName = entry.tabName || tabId;
  const fallbackBody = entry.lastUserMessage?.slice(0, 100) || tabName;
  const approvalPromptMetadata = pushType === 'needs-input' ? entry.approvalPromptMetadata ?? null : null;
  const reportCount = entry.agentReportNotice?.count ?? 1;

  let title: string;
  let body: string;
  if (pushType === 'needs-input') {
    title = 'Input Required';
    body = buildApprovalPushBody({ metadata: approvalPromptMetadata, fallbackText: fallbackBody });
  } else if (pushType === 'agent-report-paused') {
    title = 'Agent Reports Paused';
    body = `${reportCount} report(s) waiting · ${tabName}`;
  } else if (pushType === 'agent-report-expired') {
    title = 'Agent Reports Dropped';
    body = `${reportCount} report(s) not delivered in 30 min · ${tabName}`;
  } else {
    title = 'Task Complete';
    body = fallbackBody;
  }

  const payload: IStatusWebPushPayload = {
    title,
    body,
    silent: pushType === 'review' && soundOnCompleteEnabled === false,
    tabId,
    workspaceId: entry.workspaceId,
    agentSessionId: entry.agentSessionId ?? null,
    workspaceName,
    workspaceDir,
  };

  if (pushType === 'needs-input') {
    payload.approvalKind = approvalPromptMetadata?.approvalKind ?? 'unknown';
    payload.promptType = approvalPromptMetadata?.promptType ?? 'unknown';
    payload.riskLevel = approvalPromptMetadata?.riskLevel ?? 'unknown';
    payload.approvalDetail = getApprovalMetadataDetail(approvalPromptMetadata);
  }

  return payload;
};
