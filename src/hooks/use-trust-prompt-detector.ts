import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createTrustPromptTracker,
  type ITrustPromptInfo,
  type TTrustAnswer,
} from '@/lib/trust-prompt-detector';

const DEBOUNCE_MS = 200;

interface IUseTrustPromptDetectorOptions {
  enabled: boolean;
  // 탭/세션 식별자. 바뀌면 이전 탭의 prompt 상태를 버린다
  scopeKey: string | null;
  getBufferText: () => string;
  sendStdin: (data: string) => void;
}

interface IUseTrustPromptDetectorReturn {
  trustPrompt: ITrustPromptInfo | null;
  onTerminalData: () => void;
  onTrustResponse: (answer: TTrustAnswer) => void;
}

interface IDetected {
  scopeKey: string;
  info: ITrustPromptInfo;
}

const isSame = (a: IDetected | null, b: IDetected | null): boolean =>
  a?.scopeKey === b?.scopeKey
  && a?.info.agent === b?.info.agent
  && a?.info.folderPath === b?.info.folderPath
  && a?.info.selectedIndex === b?.info.selectedIndex;

const useTrustPromptDetector = ({
  enabled,
  scopeKey,
  getBufferText,
  sendStdin,
}: IUseTrustPromptDetectorOptions): IUseTrustPromptDetectorReturn => {
  const [detected, setDetected] = useState<IDetected | null>(null);
  // enabled/탭이 바뀐 렌더에서 곧바로 상태를 비운다(effect 안 setState 금지)
  const [seen, setSeen] = useState({ enabled, scopeKey });
  if (seen.enabled !== enabled || seen.scopeKey !== scopeKey) {
    setSeen({ enabled, scopeKey });
    setDetected(null);
  }
  const trackerRef = useRef(createTrustPromptTracker());
  const enabledRef = useRef(enabled);
  const scopeKeyRef = useRef(scopeKey);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getBufferTextRef = useRef(getBufferText);

  useEffect(() => {
    getBufferTextRef.current = getBufferText;
  }, [getBufferText]);

  // enabled나 탭이 바뀌면 상태·debounce를 모두 비워 이전 화면의 카드가 남지 않게 한다
  useEffect(() => {
    enabledRef.current = enabled;
    scopeKeyRef.current = scopeKey;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    trackerRef.current.reset();
  }, [enabled, scopeKey]);

  useEffect(() => () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const onTerminalData = useCallback(() => {
    if (!enabledRef.current || debounceRef.current) return;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const key = scopeKeyRef.current;
      if (!enabledRef.current || key === null) return;
      const info = trackerRef.current.observe(key, getBufferTextRef.current());
      const next = info ? { scopeKey: key, info } : null;
      setDetected((prev) => (isSame(prev, next) ? prev : next));
    }, DEBOUNCE_MS);
  }, []);

  const onTrustResponse = useCallback((answer: TTrustAnswer) => {
    const keys = trackerRef.current.respond(scopeKeyRef.current, answer);
    if (keys === null) return;
    setDetected(null);
    sendStdin(keys);
  }, [sendStdin]);

  const trustPrompt = enabled && detected && detected.scopeKey === scopeKey ? detected.info : null;

  return { trustPrompt, onTerminalData, onTrustResponse };
};

export default useTrustPromptDetector;
