import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { ClipboardAddon, type IClipboardProvider } from "@xterm/addon-clipboard";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ITerminalThemeColors } from "@/lib/terminal-themes";
import { createMultilineUrlLinkProvider } from "@/lib/multiline-url-link-provider";
import isElectron from "@/hooks/use-is-electron";
import { copyTextToClipboard } from "@/lib/clipboard";
import { getTerminalKeyDecision } from "@/lib/terminal-key-event";

interface IUseTerminalOptions {
  theme?: ITerminalThemeColors;
  fontSize?: number;
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onTitleChange?: (title: string) => void;
  customKeyEventHandler?: (event: KeyboardEvent) => boolean;
}

const COPY_TOAST_ID = 'terminal-copy';

const DEFAULT_FONT_SIZE = 12;

const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:'];

const openExternalUrl = (uri: string) => {
  try {
    const { protocol } = new URL(uri);
    if (!ALLOWED_LINK_PROTOCOLS.includes(protocol)) return;
  } catch {
    return;
  }
  if (isElectron) {
    (window as unknown as Record<string, { openExternal: (url: string) => void }>).electronAPI.openExternal(uri);
  } else {
    window.open(uri, '_blank');
  }
};

const FONT_FAMILY =
  "'MesloLGLDZ', 'Apple SD Gothic Neo', 'Pretendard', 'Menlo', 'Monaco', 'Courier New', monospace";

let fontLoadPromise: Promise<void> | null = null;
const loadFonts = () => {
  fontLoadPromise ??= (async () => {
    const fontsToLoad = [
      new FontFace('MesloLGLDZ', "url('/fonts/MesloLGLDZNerdFont-Regular.woff2')", {
        weight: '400',
        style: 'normal',
      }),
      new FontFace('MesloLGLDZ', "url('/fonts/MesloLGLDZNerdFont-Bold.woff2')", {
        weight: '700',
        style: 'normal',
      }),
    ];
    await Promise.all(
      fontsToLoad.map(async (font) => {
        await font.load();
        document.fonts.add(font);
      }),
    );
  })();
  return fontLoadPromise;
};

const useTerminal = ({ theme, fontSize = DEFAULT_FONT_SIZE, onInput, onResize, onTitleChange, customKeyEventHandler }: IUseTerminalOptions = {}) => {
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const terminalRef = useCallback((node: HTMLDivElement | null) => {
    setContainerNode(node);
  }, []);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writeQueueRef = useRef<Uint8Array[]>([]);
  const isWritingRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const t = useTranslations('terminal');

  const callbacksRef = useRef({ theme, fontSize, onInput, onResize, onTitleChange, customKeyEventHandler, t });

  useEffect(() => {
    callbacksRef.current = { theme, fontSize, onInput, onResize, onTitleChange, customKeyEventHandler, t };
  }, [theme, fontSize, onInput, onResize, onTitleChange, customKeyEventHandler, t]);

  const write = useCallback((data: Uint8Array) => {
    writeQueueRef.current.push(data);
    if (!isWritingRef.current) {
      isWritingRef.current = true;
      const flush = () => {
        requestAnimationFrame(() => {
          const terminal = terminalInstance.current;
          const queue = writeQueueRef.current;
          if (!terminal || queue.length === 0) {
            isWritingRef.current = false;
            return;
          }

          const startTime = performance.now();
          let consumed = 0;
          while (consumed < queue.length && performance.now() - startTime < 12) {
            terminal.write(queue[consumed]);
            consumed++;
          }

          if (consumed >= queue.length) {
            queue.length = 0;
            isWritingRef.current = false;
          } else {
            writeQueueRef.current = queue.slice(consumed);
            flush();
          }
        });
      };
      flush();
    }
  }, []);

  const clear = useCallback(() => {
    terminalInstance.current?.clear();
  }, []);

  const fit = useCallback((): { cols: number; rows: number } => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalInstance.current;
    if (!fitAddon || !terminal) return { cols: 80, rows: 24 };

    fitAddon.fit();
    return { cols: terminal.cols, rows: terminal.rows };
  }, []);

  const reset = useCallback(() => {
    writeQueueRef.current = [];
    isWritingRef.current = false;
    terminalInstance.current?.reset();
  }, []);

  const focus = useCallback(() => {
    terminalInstance.current?.focus();
  }, []);

  useEffect(() => {
    if (!containerNode) return;

    let disposed = false;
    let resizeRaf = 0;
    let reFitTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    let cleanupTouch: (() => void) | null = null;

    loadFonts().then(() => {
      if (disposed) return;

      const terminal = new Terminal({
        fontFamily: FONT_FAMILY,
        fontWeight: "400",
        fontWeightBold: "700",
        fontSize: callbacksRef.current.fontSize,
        lineHeight: 1.1,
        letterSpacing: 0,
        scrollback: 5000,
        cursorBlink: false,
        cursorStyle: "bar",
        allowTransparency: false,
        allowProposedApi: true,
        macOptionIsMeta: true,
        theme: callbacksRef.current.theme,
        linkHandler: {
          activate: (_event, text) => openExternalUrl(text),
          allowNonHttpProtocols: false,
        },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.registerLinkProvider(createMultilineUrlLinkProvider(terminal, openExternalUrl));
      terminal.loadAddon(new WebLinksAddon((_event, uri) => openExternalUrl(uri)));

      const unicode11Addon = new Unicode11Addon();
      terminal.loadAddon(unicode11Addon);
      terminal.unicode.activeVersion = "11";

      const clipboardProvider: IClipboardProvider = {
        // OSC 52 read는 터미널 앱이 브라우저 클립보드를 훔쳐볼 수 있어 거부한다
        readText: () => '',
        writeText: async (_selection, text) => {
          if (!text) return;
          try {
            if (await copyTextToClipboard(text)) {
              toast.success(callbacksRef.current.t('copyPaneSuccess'), { id: COPY_TOAST_ID, duration: 1500 });
            }
          } catch {
            // 브라우저 권한/포커스 이슈는 조용히 무시
          }
        },
      };
      terminal.loadAddon(new ClipboardAddon(undefined, clipboardProvider));

      terminal.open(containerNode);

      terminalInstance.current = terminal;
      fitAddonRef.current = fitAddon;

      terminal.onData((data) => {
        if (/^\x1b\[[\?>]?[\d;]*[cnR]$/.test(data)) return;
        callbacksRef.current.onInput?.(data);
      });

      terminal.onTitleChange((title) => {
        callbacksRef.current.onTitleChange?.(title);
      });

      terminal.attachCustomKeyEventHandler((event) => {
        const decision = getTerminalKeyDecision(event);
        if (decision.delegate) return true;
        // macOptionIsMeta가 이중 ESC를 보내는 키만 직접 매핑
        if (decision.input) {
          if (decision.preventDefault) event.preventDefault();
          callbacksRef.current.onInput?.(decision.input);
          return false;
        }
        return callbacksRef.current.customKeyEventHandler?.(event) ?? true;
      });

      const doFit = () => {
        fitAddon.fit();
        callbacksRef.current.onResize?.(terminal.cols, terminal.rows);
      };

      doFit();
      setIsReady(true);

      // 비동기 레이아웃 안정화 대기 (HMR, 패널 초기화 등)
      reFitTimer = window.setTimeout(() => {
        if (disposed) return;
        doFit();
      }, 500);

      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          if (disposed) return;
          doFit();
        });
      });

      resizeObserver.observe(containerNode);

      // 모바일 터치 → 합성 WheelEvent 변환 (tmux 스크롤 지원)
      // tmux mouse mode 시 xterm.js가 .xterm-screen에 wheel 리스너를 붙이므로 해당 요소에 dispatch
      const isTouchDevice = 'ontouchstart' in window && navigator.maxTouchPoints > 0;
      const screenEl = containerNode.querySelector('.xterm-screen');

      if (isTouchDevice && screenEl) {
        let lastY = 0;

        const onTouchStart = (e: TouchEvent) => {
          lastY = e.touches[0].clientY;
        };

        const onTouchMove = (e: TouchEvent) => {
          const currentY = e.touches[0].clientY;
          const deltaY = lastY - currentY;
          lastY = currentY;

          if (Math.abs(deltaY) < 3) return;

          e.preventDefault();
          screenEl.dispatchEvent(
            new WheelEvent('wheel', {
              deltaY,
              clientX: e.touches[0].clientX,
              clientY: e.touches[0].clientY,
              bubbles: true,
            })
          );
        };

        containerNode.addEventListener('touchstart', onTouchStart, { passive: true });
        containerNode.addEventListener('touchmove', onTouchMove, { passive: false });
        cleanupTouch = () => {
          containerNode.removeEventListener('touchstart', onTouchStart);
          containerNode.removeEventListener('touchmove', onTouchMove);
        };
      }
    });

    return () => {
      disposed = true;
      setIsReady(false);
      cancelAnimationFrame(resizeRaf);
      clearTimeout(reFitTimer);
      resizeObserver?.disconnect();
      cleanupTouch?.();
      terminalInstance.current?.dispose();
      terminalInstance.current = null;
      fitAddonRef.current = null;
    };
  }, [containerNode]);

  useEffect(() => {
    if (terminalInstance.current && theme) {
      terminalInstance.current.options.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    const terminal = terminalInstance.current;
    if (terminal && fontSize) {
      terminal.options.fontSize = fontSize;
      fitAddonRef.current?.fit();
      callbacksRef.current.onResize?.(terminal.cols, terminal.rows);
    }
  }, [fontSize]);

  // 현재 화면(하단 viewport)의 텍스트. trust prompt 같은 화면 감지에 쓴다.
  const getBufferText = useCallback((): string => {
    const terminal = terminalInstance.current;
    if (!terminal) return '';
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let i = buffer.baseY; i < buffer.baseY + terminal.rows; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  }, []);

  return { terminalRef, write, clear, reset, fit, focus, isReady, getBufferText };
};

export default useTerminal;
