import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import { AlertTriangle, Check, Download, Loader2, RefreshCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AppLogo from '@/components/layout/app-logo';
import InstallDialog from '@/components/features/login/install-dialog';
import { useRuntimePreflight } from '@/hooks/use-runtime-preflight';
import {
  isRuntimeOk,
  readRuntimeTerminalName,
  readRuntimeTerminalStatus,
} from '@/types/preflight';
import type { IRuntimePreflightResult, IToolStatus } from '@/types/preflight';
import AgentProviderIcon from '@/components/icons/agent-provider-icon';
import { AGENT_PROVIDER_META } from '@/lib/agent-provider-meta';
import { AGENT_PANEL_TYPES } from '@/lib/panel-type';
import { toInstallCommand } from '@/lib/onboarding-agents';

type TInstallOption = { command: string; label: string };

const isAgentOk = (agent: IToolStatus | undefined): boolean =>
  !!agent && agent.installed && agent.compatible !== false;

// Terminal and git come first; once they pass, any one agent is enough, so a
// host with no agent is offered a choice instead of a single install.
const getNextInstalls = (
  status: IRuntimePreflightResult,
  t: (key: string, values?: Record<string, string>) => string,
): TInstallOption[] => {
  const terminal = readRuntimeTerminalStatus(status);
  if (!(terminal.installed && terminal.compatible)) {
    if (terminal.adapter !== 'tmux') return [];
    const needsUpgrade = terminal.installed && !terminal.compatible;
    return [{
      command: needsUpgrade ? 'tmux-upgrade' : 'tmux-install',
      label: needsUpgrade ? t('upgradeTmux') : t('installTmux'),
    }];
  }
  if (!status.git.installed) {
    return [{ command: 'git', label: t('installGit') }];
  }
  if (AGENT_PANEL_TYPES.some((panelType) => isAgentOk(status.agents[panelType]))) return [];
  return AGENT_PANEL_TYPES.map((panelType) => {
    const agent = status.agents[panelType];
    const label = AGENT_PROVIDER_META[panelType].label;
    if (agent && !agent.installed && agent.binaryPath) {
      return { command: toInstallCommand(panelType, 'path'), label: t('fixAgentPath', { agent: label }) };
    }
    return {
      command: toInstallCommand(panelType, 'install'),
      label: agent?.installed ? t('updateAgent', { agent: label }) : t('installAgent', { agent: label }),
    };
  });
};

const ToolsRequiredPage = () => {
  const t = useTranslations('toolsRequired');
  const router = useRouter();
  const from = (router.query.from as string) || '/';
  const { status, checking, recheck } = useRuntimePreflight();
  const [installTarget, setInstallTarget] = useState<{ command: string; label: string } | null>(null);

  useEffect(() => {
    if (status && isRuntimeOk(status)) {
      window.location.href = from;
    }
  }, [status, from]);

  const tools = status
    ? [
        {
          name: readRuntimeTerminalName(status),
          ok: readRuntimeTerminalStatus(status).installed && readRuntimeTerminalStatus(status).compatible,
          version: readRuntimeTerminalStatus(status).version,
        },
        { name: 'Git', ok: status.git.installed, version: status.git.version },
      ]
    : [];

  const agentRows = status
    ? AGENT_PANEL_TYPES.map((panelType) => {
        const agent = status.agents[panelType];
        const ok = isAgentOk(agent);
        const state = ok
          ? 'ready'
          : agent?.installed
            ? 'needsUpdate'
            : agent?.binaryPath
              ? 'pathMissing'
              : 'notInstalled';
        return { panelType, ok, version: agent?.version ?? null, state };
      })
    : [];

  const nextInstalls = status ? getNextInstalls(status, t) : [];

  return (
    <>
      <Head>
        <title>{t('pageTitle')}</title>
      </Head>
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <AppLogo shimmer size="xl" className="justify-center" />

          {checking && !status ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{t('checking')}</span>
            </div>
          ) : status && isRuntimeOk(status) ? (
            <div className="flex items-center justify-center gap-2 py-8 text-positive">
              <Check className="h-5 w-5" />
              <span className="text-sm font-medium">{t('allGood')}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-ui-amber">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <p className="text-sm font-medium">{t('title')}</p>
              </div>
              <p className="text-sm text-muted-foreground">{t('description')}</p>
              <div className="space-y-1.5">
                {tools.map((tool) => (
                  <div key={tool.name} className="flex items-center gap-2 text-sm">
                    {tool.ok ? (
                      <Check className="h-4 w-4 shrink-0 text-positive" />
                    ) : (
                      <X className="h-4 w-4 shrink-0 text-negative" />
                    )}
                    <span className={tool.ok ? 'text-muted-foreground' : 'text-foreground font-medium'}>
                      {tool.name}
                    </span>
                    {tool.version && (
                      <span className="text-xs text-muted-foreground">({tool.version})</span>
                    )}
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted-foreground [word-break:keep-all]">{t('agentsHint')}</p>
                {agentRows.map((row) => (
                  <div key={row.panelType} className="flex items-center gap-2 text-sm">
                    {row.ok ? (
                      <Check className="h-4 w-4 shrink-0 text-positive" />
                    ) : (
                      <X className="h-4 w-4 shrink-0 text-negative" />
                    )}
                    <AgentProviderIcon panelType={row.panelType} className="h-4 w-4 shrink-0" />
                    <span className={row.ok ? 'text-muted-foreground' : 'text-foreground font-medium'}>
                      {AGENT_PROVIDER_META[row.panelType].label}
                    </span>
                    <span className="text-xs text-muted-foreground [word-break:keep-all]">
                      {row.version ? `(${row.version})` : t(`agentState.${row.state}`)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                {nextInstalls.map((option) => (
                  <Button
                    key={option.command}
                    size="lg"
                    className="h-12 w-full active:scale-[0.99] focus-visible:ring-2"
                    onClick={() => setInstallTarget(option)}
                  >
                    <Download className="mr-1 h-4 w-4" />
                    {option.label}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 w-full"
                  disabled={checking}
                  onClick={recheck}
                >
                  <RefreshCcw className="mr-1 h-4 w-4" />
                  {t('recheck')}
                </Button>
              </div>
            </div>
          )}

          {installTarget && (
            <InstallDialog
              open
              onOpenChange={() => setInstallTarget(null)}
              command={installTarget.command}
              label={installTarget.label}
            />
          )}
        </div>
      </div>
    </>
  );
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { requireAuth } = await import('@/lib/require-auth');
  const { loadMessagesServerBundle } = await import('@/lib/load-messages');
  return requireAuth(context, async () => {
    const { locale, messages } = await loadMessagesServerBundle();
    return { props: { messages, messagesLocale: locale } };
  }, { skipPreflight: true });
};

export default ToolsRequiredPage;
