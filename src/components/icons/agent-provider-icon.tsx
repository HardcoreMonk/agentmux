import ClaudeIcon from '@/components/icons/claude-icon';
import OpenAIIcon from '@/components/icons/openai-icon';
import type { TAgentPanelType } from '@/types/terminal';

interface IAgentProviderIconProps {
  panelType: TAgentPanelType;
  className?: string;
}

const AGENT_PROVIDER_ICONS: Record<TAgentPanelType, typeof OpenAIIcon> = {
  codex: OpenAIIcon,
  claude: ClaudeIcon,
};

const AgentProviderIcon = ({ panelType, className }: IAgentProviderIconProps) => {
  const Icon = AGENT_PROVIDER_ICONS[panelType];
  return <Icon className={className} />;
};

export default AgentProviderIcon;
