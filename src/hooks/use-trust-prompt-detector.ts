import { useCallback, useEffect, useRef, useState } from 'react';
import { matchTrustPrompt, trustAnswerKeys, type ITrustPromptInfo, type TTrustAnswer } from '@/lib/trust-prompt-detector';

const DEBOUNCE_MS = 200;

interface IUseTrustPromptDetectorOptions {
  enabled: boolean;
  getBufferText: () => string;
  sendStdin: (data: string) => void;
}

interface IUseTrustPromptDetectorReturn {
  trustPrompt: ITrustPromptInfo | null;
  onTerminalData: () => void;
  onTrustResponse: (answer: TTrustAnswer) => void;
}

const isSamePrompt = (a: ITrustPromptInfo | null, b: ITrustPromptInfo | null): boolean =>
  a?.agent === b?.agent
  && a?.folderPath === b?.folderPath
  && a?.selectedIndex === b?.selectedIndex;

const useTrustPromptDetector = ({
  enabled,
  getBufferText,
  sendStdin,
}: IUseTrustPromptDetectorOptions): IUseTrustPromptDetectorReturn => {
  const [trustPrompt, setTrustPrompt] = useState<ITrustPromptInfo | null>(null);
  const trustPromptRef = useRef<ITrustPromptInfo | null>(null);
  const enabledRef = useRef(enabled);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getBufferTextRef = useRef(getBufferText);

  useEffect(() => {
    trustPromptRef.current = trustPrompt;
  }, [trustPrompt]);

  useEffect(() => {
    getBufferTextRef.current = getBufferText;
  }, [getBufferText]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled && debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [enabled]);

  useEffect(() => () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const effectiveTrustPrompt = enabled ? trustPrompt : null;

  const onTerminalData = useCallback(() => {
    if (!enabledRef.current || debounceRef.current) return;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (!enabledRef.current) return;
      const matched = matchTrustPrompt(getBufferTextRef.current());
      setTrustPrompt((prev) => (isSamePrompt(prev, matched) ? prev : matched));
    }, DEBOUNCE_MS);
  }, []);

  const onTrustResponse = useCallback((answer: TTrustAnswer) => {
    const info = trustPromptRef.current;
    if (!info) return;
    setTrustPrompt(null);
    sendStdin(trustAnswerKeys(info, answer));
  }, [sendStdin]);

  return { trustPrompt: effectiveTrustPrompt, onTerminalData, onTrustResponse };
};

export default useTrustPromptDetector;
