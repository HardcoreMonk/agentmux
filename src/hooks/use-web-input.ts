import { useState, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import type { TCliState } from '@/types/timeline';
import { isCliIdle } from '@/hooks/use-tab-store';
import { getAgentLabel, getAgentProviderMeta } from '@/lib/agent-provider-meta';
import type { TPanelType } from '@/types/terminal';

type TWebInputMode = 'input' | 'interrupt' | 'disabled';

const DEFAULT_RESTART_COMMANDS: readonly string[] = ['/new', '/clear'];
const DEFAULT_INTERRUPT_SEQUENCE = '\x1b\x1b';
const DRAFT_KEY_PREFIX = 'pt-input-draft:';
const WEB_INPUT_FOLLOW_UP_ENTER_DELAY_MS = 600;

interface IWebInputFrame {
  data: string;
  delayMs?: number;
}

const getDraftKey = (tabId: string) => `${DRAFT_KEY_PREFIX}${tabId}`;

const saveDraft = (tabId: string, value: string) => {
  try {
    if (value) {
      localStorage.setItem(getDraftKey(tabId), value);
    } else {
      localStorage.removeItem(getDraftKey(tabId));
    }
  } catch {
    /* quota exceeded 등 무시 */
  }
};

const loadDraft = (tabId: string): string => {
  try {
    return localStorage.getItem(getDraftKey(tabId)) ?? '';
  } catch {
    return '';
  }
};

const clearDraft = (tabId: string) => {
  try {
    localStorage.removeItem(getDraftKey(tabId));
  } catch {
    /* ignore */
  }
};

const buildWebInputFrames = (raw: string): IWebInputFrame[] => [
  { data: `\x1b[200~${raw}\x1b[201~\r` },
  { data: '\r', delayMs: WEB_INPUT_FOLLOW_UP_ENTER_DELAY_MS },
];

interface IUseWebInputReturn {
  value: string;
  setValue: (v: string) => void;
  mode: TWebInputMode;
  canSend: boolean;
  send: () => void;
  interrupt: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  focusInput: () => void;
}

interface IUseWebInputOptions {
  tabId?: string;
  panelType?: TPanelType;
  onRestartSession?: () => void;
  onMessageSent?: (message: string) => void;
}

const useWebInput = (
  cliState: TCliState,
  sendStdin: (data: string) => void,
  terminalWsConnected: boolean,
  options?: IUseWebInputOptions,
): IUseWebInputReturn => {
  const tabId = options?.tabId;
  const providerMeta = getAgentProviderMeta(options?.panelType);
  const agentLabel = getAgentLabel(options?.panelType);
  const restartCommands = providerMeta?.restartCommands ?? DEFAULT_RESTART_COMMANDS;
  const interruptSequence = providerMeta?.interruptSequence ?? DEFAULT_INTERRUPT_SEQUENCE;
  const [value, setValueState] = useState(() => (tabId ? loadDraft(tabId) : ''));
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mode: TWebInputMode = useMemo(() => {
    if (isCliIdle(cliState) || cliState === 'unknown') return 'input';
    if (cliState === 'busy' || cliState === 'needs-input') return 'interrupt';
    return 'disabled';
  }, [cliState]);

  const onRestartSession = options?.onRestartSession;
  const onMessageSent = options?.onMessageSent;

  const setValue = useCallback((next: string) => {
    setValueState(next);
    if (tabId) saveDraft(tabId, next);
  }, [tabId]);

  const send = useCallback(() => {
    if (mode === 'disabled') {
      toast.error(t('terminal', 'inputDisabledPlaceholder', { agent: agentLabel }));
      return;
    }

    if (!terminalWsConnected) {
      toast.error(t('connection', 'terminalDisconnected'));
      return;
    }

    if (value.trim() === '') return;

    if (restartCommands.includes(value.trim().toLowerCase())) {
      onRestartSession?.();
      setValue('');
      if (tabId) clearDraft(tabId);
      return;
    }

    const message = value.trim();
    if (!message.startsWith('/')) {
      onMessageSent?.(message);
    }

    buildWebInputFrames(value).forEach((frame) => {
      if (frame.delayMs) {
        setTimeout(() => sendStdin(frame.data), frame.delayMs);
        return;
      }
      sendStdin(frame.data);
    });

    setValue('');
    if (tabId) clearDraft(tabId);
  }, [mode, value, sendStdin, terminalWsConnected, onRestartSession, onMessageSent, tabId, setValue, restartCommands, agentLabel]);

  const interrupt = useCallback(() => {
    if (!terminalWsConnected) {
      toast.error(t('connection', 'terminalDisconnected'));
      return;
    }
    sendStdin(interruptSequence);
  }, [sendStdin, terminalWsConnected, interruptSequence]);

  const focusInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  const canSend = mode !== 'disabled' && terminalWsConnected;

  return {
    value,
    setValue,
    mode,
    canSend,
    send,
    interrupt,
    textareaRef,
    focusInput,
  };
};

export default useWebInput;
export {
  WEB_INPUT_FOLLOW_UP_ENTER_DELAY_MS,
  buildWebInputFrames,
  clearDraft as clearInputDraft,
};
export type { TWebInputMode };
