import useConfigStore from '@/hooks/use-config-store';

type TMessages = Record<string, Record<string, unknown>>;

let _messages: TMessages | null = null;

export const setMessages = (messages: TMessages) => {
  _messages = messages;
};

export const t = (namespace: string, key: string, values?: Record<string, string>): string => {
  if (!_messages) return key;
  const locale = useConfigStore.getState().locale;
  const ns = (_messages[locale]?.[namespace] ?? _messages.en?.[namespace]) as Record<string, string> | undefined;
  const text = ns?.[key] ?? key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
};
