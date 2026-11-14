import { useCallback, useEffect, useRef, useState } from 'react';
import {
  codexHooksReviewKeys,
  codexUpdateAnswerKeys,
  type TCodexHooksAnswer,
  type TCodexUpdateAnswer,
} from '@/lib/codex-screen';
import { createCodexScreenTracker, type ICodexScreenSnapshot } from '@/lib/codex-screen-tracker';

const DEBOUNCE_MS = 200;

const EMPTY_SNAPSHOT: ICodexScreenSnapshot = { hooksReview: null, updatePrompt: null, blocking: false, tuiReady: false };

interface IUseCodexScreenDetectorOptions {
  enabled: boolean;
  scopeKey: string | null;
  getBufferText: () => string;
  sendStdin: (data: string) => void;
}

interface IUseCodexScreenDetectorReturn {
  snapshot: ICodexScreenSnapshot;
  // Unknown or failed lookups count as trusted so the trust button stays hidden.
  fingerprintTrusted: boolean;
  onTerminalData: () => void;
  respondHooks: (answer: TCodexHooksAnswer) => void;
  respondUpdate: (answer: TCodexUpdateAnswer) => void;
}

interface IDetected {
  scopeKey: string;
  snapshot: ICodexScreenSnapshot;
}

const isSame = (a: IDetected | null, b: IDetected | null): boolean =>
  a?.scopeKey === b?.scopeKey && JSON.stringify(a?.snapshot) === JSON.stringify(b?.snapshot);

const useCodexScreenDetector = ({
  enabled,
  scopeKey,
  getBufferText,
  sendStdin,
}: IUseCodexScreenDetectorOptions): IUseCodexScreenDetectorReturn => {
  const [detected, setDetected] = useState<IDetected | null>(null);
  const [seen, setSeen] = useState({ enabled, scopeKey });
  if (seen.enabled !== enabled || seen.scopeKey !== scopeKey) {
    setSeen({ enabled, scopeKey });
    setDetected(null);
  }
  const [tracker] = useState(() => createCodexScreenTracker({ now: () => Date.now() }));
  const enabledRef = useRef(enabled);
  const scopeKeyRef = useRef(scopeKey);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getBufferTextRef = useRef(getBufferText);
  const detectedRef = useRef<IDetected | null>(null);

  useEffect(() => {
    getBufferTextRef.current = getBufferText;
  }, [getBufferText]);

  useEffect(() => {
    detectedRef.current = detected;
  }, [detected]);

  useEffect(() => {
    enabledRef.current = enabled;
    scopeKeyRef.current = scopeKey;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (scopeKey !== null) tracker.startScope(scopeKey, false);
  }, [enabled, scopeKey, tracker]);

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
      const next = { scopeKey: key, snapshot: tracker.observe(key, getBufferTextRef.current()) };
      setDetected((prev) => (isSame(prev, next) ? prev : next));
    }, DEBOUNCE_MS);
  }, [tracker]);

  const hide = useCallback((key: 'hooksReview' | 'updatePrompt') => {
    setDetected((prev) => (prev ? { ...prev, snapshot: { ...prev.snapshot, [key]: null } } : prev));
  }, []);

  const respondHooks = useCallback((answer: TCodexHooksAnswer) => {
    const key = scopeKeyRef.current;
    const info = detectedRef.current?.snapshot.hooksReview;
    if (key === null || !info) return;
    const keys = codexHooksReviewKeys(info, answer);
    if (keys === null) return;
    tracker.markResponded(key);
    hide('hooksReview');
    sendStdin(keys);
  }, [tracker, hide, sendStdin]);

  const respondUpdate = useCallback((answer: TCodexUpdateAnswer) => {
    const key = scopeKeyRef.current;
    if (key === null || !detectedRef.current?.snapshot.updatePrompt) return;
    tracker.markResponded(key);
    hide('updatePrompt');
    sendStdin(codexUpdateAnswerKeys(answer));
  }, [tracker, hide, sendStdin]);

  const active = enabled && detected !== null && detected.scopeKey === scopeKey;
  const snapshot = active ? detected.snapshot : EMPTY_SNAPSHOT;

  const reviewVisible = snapshot.hooksReview !== null;
  const [seenVisible, setSeenVisible] = useState(reviewVisible);
  const [fingerprint, setFingerprint] = useState<boolean | null>(null);
  if (seenVisible !== reviewVisible) {
    setSeenVisible(reviewVisible);
    setFingerprint(null);
  }

  useEffect(() => {
    if (!reviewVisible || fingerprint !== null) return;
    let cancelled = false;
    fetch('/api/status/codex-hook-trust')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { trusted?: unknown } | null) => (typeof data?.trusted === 'boolean' ? data.trusted : true))
      .catch(() => true)
      .then((trusted) => {
        if (!cancelled) setFingerprint(trusted);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewVisible, fingerprint]);

  return { snapshot, fingerprintTrusted: fingerprint ?? true, onTerminalData, respondHooks, respondUpdate };
};

export default useCodexScreenDetector;
