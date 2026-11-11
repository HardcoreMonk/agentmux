import { create } from 'zustand';
import type { TEditorPreset } from '@/lib/editor-url';
import type { TToastPosition } from '@/lib/toast-position';
import type { TCodexApprovalPolicy, TCodexSandboxMode } from '@/lib/codex-command';
import { isValidClaudeModel, type TClaudePermissionMode } from '@/lib/claude-config-values';
import { DEFAULT_LOCALE, normalizeLocale } from '@/lib/locales';

export type { TToastPosition } from '@/lib/toast-position';

export type TNetworkAccess = 'localhost' | 'tailscale' | 'all';

export const DEFAULT_TOAST_DURATION = 10000;
export const DEFAULT_TOAST_POSITION_DESKTOP: TToastPosition = 'top-right';
export const DEFAULT_TOAST_POSITION_MOBILE: TToastPosition = 'top-center';

export interface IConfigInitialData {
  appTheme?: string | null;
  terminalTheme?: { light: string; dark: string } | null;
  customCSS?: string;
  dangerouslySkipPermissions?: boolean;
  codexModel?: string | null;
  codexSandbox?: TCodexSandboxMode | null;
  codexApprovalPolicy?: TCodexApprovalPolicy | null;
  codexSearchEnabled?: boolean;
  codexShowTerminal?: boolean;
  agentShowTerminal?: boolean;
  agentDelegationGuideEnabled?: boolean;
  claudeModel?: string | null;
  claudePermissionMode?: TClaudePermissionMode | null;
  editorUrl?: string;
  editorPreset?: TEditorPreset;
  notificationsEnabled?: boolean;
  soundOnCompleteEnabled?: boolean;
  toastOnCompleteEnabled?: boolean;
  toastDuration?: number;
  toastPositionDesktop?: TToastPosition;
  toastPositionMobile?: TToastPosition;
  hasAuthPassword?: boolean;
  locale?: string;
  fontSize?: string;
  systemResourcesEnabled?: boolean;
  networkAccess?: TNetworkAccess;
  hostEnvLocked?: boolean;
  bindHostIsLocal?: boolean;
}

interface IConfigState {
  dangerouslySkipPermissions: boolean;
  codexModel: string;
  codexSandbox: TCodexSandboxMode | '';
  codexApprovalPolicy: TCodexApprovalPolicy | '';
  codexSearchEnabled: boolean;
  agentShowTerminal: boolean;
  agentDelegationGuideEnabled: boolean;
  claudeModel: string;
  claudePermissionMode: TClaudePermissionMode | '';
  editorUrl: string;
  editorPreset: TEditorPreset;
  notificationsEnabled: boolean;
  soundOnCompleteEnabled: boolean;
  toastOnCompleteEnabled: boolean;
  toastDuration: number;
  toastPositionDesktop: TToastPosition;
  toastPositionMobile: TToastPosition;
  hasAuthPassword: boolean;
  locale: string;
  customCSS: string;
  fontSize: string;
  systemResourcesEnabled: boolean;
  networkAccess: TNetworkAccess;
  hostEnvLocked: boolean;
  bindHostIsLocal: boolean;

  hydrate: (data: IConfigInitialData) => void;
  setDangerouslySkipPermissions: (enabled: boolean) => void;
  setCodexModel: (model: string) => void;
  setCodexSandbox: (sandbox: TCodexSandboxMode | '') => void;
  setCodexApprovalPolicy: (policy: TCodexApprovalPolicy | '') => void;
  setCodexSearchEnabled: (enabled: boolean) => void;
  setAgentShowTerminal: (enabled: boolean) => void;
  setAgentDelegationGuideEnabled: (enabled: boolean) => void;
  setClaudeModel: (model: string) => void;
  setClaudePermissionMode: (mode: TClaudePermissionMode | '') => void;
  setEditorUrl: (url: string) => void;
  setEditorPreset: (preset: TEditorPreset) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setSoundOnCompleteEnabled: (enabled: boolean) => void;
  setToastOnCompleteEnabled: (enabled: boolean) => void;
  setToastDuration: (duration: number) => void;
  setToastPositionDesktop: (position: TToastPosition) => void;
  setToastPositionMobile: (position: TToastPosition) => void;
  changePassword: (password: string) => void;
  setLocale: (locale: string) => void;
  setCustomCSS: (css: string) => void;
  setFontSize: (fontSize: string) => void;
  setSystemResourcesEnabled: (enabled: boolean) => void;
  setNetworkAccess: (value: TNetworkAccess) => void;
}

const initialConfig = {
  notificationsEnabled: true,
  soundOnCompleteEnabled: true,
  toastOnCompleteEnabled: true,
  toastDuration: DEFAULT_TOAST_DURATION,
  toastPositionDesktop: DEFAULT_TOAST_POSITION_DESKTOP,
  toastPositionMobile: DEFAULT_TOAST_POSITION_MOBILE,
  editorUrl: '',
  editorPreset: 'code-server' as TEditorPreset,
  dangerouslySkipPermissions: false,
  codexModel: '',
  codexSandbox: '' as TCodexSandboxMode | '',
  codexApprovalPolicy: '' as TCodexApprovalPolicy | '',
  codexSearchEnabled: false,
  agentShowTerminal: true,
  agentDelegationGuideEnabled: true,
  claudeModel: '',
  claudePermissionMode: '' as TClaudePermissionMode | '',
  hasAuthPassword: false,
  locale: DEFAULT_LOCALE,
  customCSS: '',
  fontSize: 'normal',
  systemResourcesEnabled: false,
  networkAccess: 'all' as TNetworkAccess,
  hostEnvLocked: false,
  bindHostIsLocal: false,
};

const saveConfig = (updates: Record<string, unknown>) => {
  fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }).catch((err) => {
    console.log(`[config-store] update failed: ${err instanceof Error ? err.message : err}`);
  });
};

const useConfigStore = create<IConfigState>((set, get) => ({
  dangerouslySkipPermissions: initialConfig.dangerouslySkipPermissions,
  codexModel: initialConfig.codexModel,
  codexSandbox: initialConfig.codexSandbox,
  codexApprovalPolicy: initialConfig.codexApprovalPolicy,
  codexSearchEnabled: initialConfig.codexSearchEnabled,
  agentShowTerminal: initialConfig.agentShowTerminal,
  agentDelegationGuideEnabled: initialConfig.agentDelegationGuideEnabled,
  claudeModel: initialConfig.claudeModel,
  claudePermissionMode: initialConfig.claudePermissionMode,
  editorUrl: initialConfig.editorUrl,
  editorPreset: initialConfig.editorPreset,
  notificationsEnabled: initialConfig.notificationsEnabled,
  soundOnCompleteEnabled: initialConfig.soundOnCompleteEnabled,
  toastOnCompleteEnabled: initialConfig.toastOnCompleteEnabled,
  toastDuration: initialConfig.toastDuration,
  toastPositionDesktop: initialConfig.toastPositionDesktop,
  toastPositionMobile: initialConfig.toastPositionMobile,
  hasAuthPassword: initialConfig.hasAuthPassword,
  locale: initialConfig.locale,
  customCSS: initialConfig.customCSS,
  fontSize: initialConfig.fontSize,
  systemResourcesEnabled: initialConfig.systemResourcesEnabled,
  networkAccess: initialConfig.networkAccess,
  hostEnvLocked: initialConfig.hostEnvLocked,
  bindHostIsLocal: initialConfig.bindHostIsLocal,

  hydrate: (data) => {
    set({
      dangerouslySkipPermissions: data.dangerouslySkipPermissions ?? false,
      codexModel: data.codexModel ?? '',
      codexSandbox: data.codexSandbox ?? '',
      codexApprovalPolicy: data.codexApprovalPolicy ?? '',
      codexSearchEnabled: data.codexSearchEnabled ?? false,
      // Legacy codexShowTerminal is read as a fallback only; writes go to agentShowTerminal.
      agentShowTerminal: data.agentShowTerminal ?? data.codexShowTerminal ?? true,
      // Absent means on, matching the server (`value !== false`).
      agentDelegationGuideEnabled: data.agentDelegationGuideEnabled !== false,
      claudeModel: data.claudeModel ?? '',
      claudePermissionMode: data.claudePermissionMode ?? '',
      editorUrl: data.editorUrl ?? '',
      editorPreset: data.editorPreset ?? 'code-server',
      notificationsEnabled: data.notificationsEnabled ?? true,
      soundOnCompleteEnabled: data.soundOnCompleteEnabled ?? true,
      toastOnCompleteEnabled: data.toastOnCompleteEnabled ?? true,
      toastDuration: data.toastDuration ?? DEFAULT_TOAST_DURATION,
      toastPositionDesktop: data.toastPositionDesktop ?? DEFAULT_TOAST_POSITION_DESKTOP,
      toastPositionMobile: data.toastPositionMobile ?? DEFAULT_TOAST_POSITION_MOBILE,
      hasAuthPassword: data.hasAuthPassword ?? false,
      locale: normalizeLocale(data.locale),
      customCSS: data.customCSS ?? '',
      fontSize: data.fontSize ?? 'normal',
      systemResourcesEnabled: data.systemResourcesEnabled ?? false,
      networkAccess: data.networkAccess ?? 'all',
      hostEnvLocked: data.hostEnvLocked ?? false,
      bindHostIsLocal: data.bindHostIsLocal ?? false,
    });
  },

  setDangerouslySkipPermissions: (enabled) => {
    set({ dangerouslySkipPermissions: enabled });
    saveConfig({ dangerouslySkipPermissions: enabled });
  },

  setCodexModel: (model) => {
    if (get().codexModel === model) return;
    set({ codexModel: model });
    saveConfig({ codexModel: model.trim() || null });
  },

  setCodexSandbox: (sandbox) => {
    if (get().codexSandbox === sandbox) return;
    set({ codexSandbox: sandbox });
    saveConfig({ codexSandbox: sandbox || null });
  },

  setCodexApprovalPolicy: (policy) => {
    if (get().codexApprovalPolicy === policy) return;
    set({ codexApprovalPolicy: policy });
    saveConfig({ codexApprovalPolicy: policy || null });
  },

  setCodexSearchEnabled: (enabled) => {
    if (get().codexSearchEnabled === enabled) return;
    set({ codexSearchEnabled: enabled });
    saveConfig({ codexSearchEnabled: enabled });
  },

  setAgentShowTerminal: (enabled) => {
    if (get().agentShowTerminal === enabled) return;
    set({ agentShowTerminal: enabled });
    saveConfig({ agentShowTerminal: enabled });
  },

  setAgentDelegationGuideEnabled: (enabled) => {
    if (get().agentDelegationGuideEnabled === enabled) return;
    set({ agentDelegationGuideEnabled: enabled });
    saveConfig({ agentDelegationGuideEnabled: enabled });
  },

  setClaudeModel: (model) => {
    const next = model.trim();
    if (get().claudeModel === next) return;
    if (next && !isValidClaudeModel(next)) return;
    set({ claudeModel: next });
    saveConfig({ claudeModel: next || null });
  },

  setClaudePermissionMode: (mode) => {
    if (get().claudePermissionMode === mode) return;
    set({ claudePermissionMode: mode });
    saveConfig({ claudePermissionMode: mode || null });
  },

  setEditorUrl: (url) => {
    if (get().editorUrl === url) return;
    set({ editorUrl: url });
    saveConfig({ editorUrl: url });
  },

  setEditorPreset: (preset) => {
    if (get().editorPreset === preset) return;
    set({ editorPreset: preset });
    saveConfig({ editorPreset: preset });
  },

  setNotificationsEnabled: (enabled) => {
    set({ notificationsEnabled: enabled });
    saveConfig({ notificationsEnabled: enabled });
  },

  setSoundOnCompleteEnabled: (enabled) => {
    if (get().soundOnCompleteEnabled === enabled) return;
    set({ soundOnCompleteEnabled: enabled });
    saveConfig({ soundOnCompleteEnabled: enabled });
  },

  setToastOnCompleteEnabled: (enabled) => {
    if (get().toastOnCompleteEnabled === enabled) return;
    set({ toastOnCompleteEnabled: enabled });
    saveConfig({ toastOnCompleteEnabled: enabled });
  },

  setToastDuration: (duration) => {
    if (get().toastDuration === duration) return;
    set({ toastDuration: duration });
    saveConfig({ toastDuration: duration });
  },

  setToastPositionDesktop: (position) => {
    if (get().toastPositionDesktop === position) return;
    set({ toastPositionDesktop: position });
    saveConfig({ toastPositionDesktop: position });
  },

  setToastPositionMobile: (position) => {
    if (get().toastPositionMobile === position) return;
    set({ toastPositionMobile: position });
    saveConfig({ toastPositionMobile: position });
  },

  changePassword: (password) => {
    set({ hasAuthPassword: true });
    saveConfig({ authPassword: password });
  },

  setLocale: (locale) => {
    const nextLocale = normalizeLocale(locale);
    set({ locale: nextLocale });
    saveConfig({ locale: nextLocale });
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).electronAPI) {
      (window as unknown as { electronAPI: { setLocale: (l: string) => void } }).electronAPI.setLocale(nextLocale);
    }
  },

  setCustomCSS: (css) => {
    set({ customCSS: css });
    saveConfig({ customCSS: css });
  },

  setFontSize: (fontSize) => {
    set({ fontSize });
    saveConfig({ fontSize });
  },

  setSystemResourcesEnabled: (enabled) => {
    set({ systemResourcesEnabled: enabled });
    saveConfig({ systemResourcesEnabled: enabled });
  },

  setNetworkAccess: (value) => {
    set({ networkAccess: value });
    saveConfig({ networkAccess: value });
  },
}));

export default useConfigStore;
