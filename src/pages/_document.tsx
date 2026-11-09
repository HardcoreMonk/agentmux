import Document, { Html, Head, Main, NextScript, type DocumentContext, type DocumentInitialProps } from 'next/document';
import { getWorkspaces } from '@/lib/workspace-store';
import { getConfig } from '@/lib/config-store';
import { DEFAULT_LOCALE, normalizeLocale, type TSupportedLocale } from '@/lib/locales';

const STALE_CHUNK_RELOAD_SCRIPT = `
(function(){
  var key='agentmux:stale-chunk-reload-at';
  var isChunkUrl=function(value){
    return typeof value==='string'&&value.indexOf('/_next/static/chunks/')!==-1&&/\\.js(?:\\?|$)/.test(value);
  };
  var toText=function(value){
    if(!value)return'';
    if(typeof value==='string')return value;
    if(value.message)return String(value.message);
    if(value.stack)return String(value.stack);
    try{return JSON.stringify(value)}catch(e){return String(value)}
  };
  var isChunkFailure=function(event){
    var target=event&&event.target;
    if(target&&target.tagName==='SCRIPT'&&isChunkUrl(target.src))return true;
    var reason=event&&('reason'in event?event.reason:event.error||event.message);
    var text=toText(reason);
    return text.indexOf('ChunkLoadError')!==-1||text.indexOf('Loading chunk')!==-1||isChunkUrl(text);
  };
  var reload=function(){
    try{
      var now=Date.now();
      var prev=Number(sessionStorage.getItem(key)||0);
      if(now-prev<15000)return;
      sessionStorage.setItem(key,String(now));
    }catch(e){}
    location.reload();
  };
  addEventListener('error',function(event){if(isChunkFailure(event))reload()},true);
  addEventListener('unhandledrejection',function(event){if(isChunkFailure(event))reload()});
  setTimeout(function(){try{sessionStorage.removeItem(key)}catch(e){}},30000);
})();
`;

interface IDocumentProps extends DocumentInitialProps {
  activeWorkspaceId: string;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  locale: TSupportedLocale;
}

class MyDocument extends Document<IDocumentProps> {
  static async getInitialProps(ctx: DocumentContext): Promise<IDocumentProps> {
    const initialProps = await Document.getInitialProps(ctx);
    const [wsData, config] = await Promise.all([
      getWorkspaces().catch(() => null),
      getConfig().catch(() => null),
    ]);

    return {
      ...initialProps,
      activeWorkspaceId: wsData?.activeWorkspaceId ?? '',
      sidebarWidth: wsData?.sidebarWidth ?? 240,
      sidebarCollapsed: wsData?.sidebarCollapsed ?? false,
      locale: normalizeLocale(config?.locale ?? DEFAULT_LOCALE),
    };
  }

  render() {
    const sidebarWidth = Number(this.props.sidebarWidth) || 240;
    const sidebarCollapsed = !!this.props.sidebarCollapsed;
    const effectiveWidth = sidebarCollapsed ? 0 : sidebarWidth;
    const effectiveMinWidth = sidebarCollapsed ? 0 : 160;

    const serverActiveWs = JSON.stringify(this.props.activeWorkspaceId || '');
    const initScript = `window.__SB__=(function(){var s=sessionStorage,l=localStorage,t=l.getItem("sidebar-tab"),a=s.getItem("active-ws")||${serverActiveWs};return{w:${sidebarWidth},c:${sidebarCollapsed},t:t==="sessions"||t==="activity"?"activity":"workspace",a:a||""}})()`;

    return (
      <Html lang={this.props.locale} suppressHydrationWarning>
        <Head>
          <link rel="preload" as="font" type="font/woff2" href="/fonts/PretendardVariable.woff2" crossOrigin="anonymous" />
          <link rel="preload" as="font" type="font/woff2" href="/fonts/MesloLGLDZNerdFont-Regular.woff2" crossOrigin="anonymous" />
          <link rel="preload" as="font" type="font/woff2" href="/fonts/MesloLGLDZNerdFont-Bold.woff2" crossOrigin="anonymous" />
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
          <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
          <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
          <link rel="manifest" href="/api/manifest" />
          <meta name="msapplication-TileColor" content="#131313" />
          <meta name="theme-color" content="#131313" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <script dangerouslySetInnerHTML={{ __html: STALE_CHUNK_RELOAD_SCRIPT }} />
          <link rel="apple-touch-startup-image" href="/splash/splash-1320x2868.png" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1206x2622.png" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1290x2796.png" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1179x2556.png" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1170x2532.png" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1125x2436.png" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1242x2688.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-828x1792.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-750x1334.png" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-640x1136.png" media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-2048x2732.png" media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1668x2388.png" media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1640x2360.png" media="(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1620x2160.png" media="(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1488x2266.png" media="(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2)" />
          <style dangerouslySetInnerHTML={{ __html: `:root{--initial-sb-w:${effectiveWidth}px;--initial-sb-mw:${effectiveMinWidth}px}` }} />
          <script dangerouslySetInnerHTML={{ __html: initScript }} />
          <script dangerouslySetInnerHTML={{ __html: `if(window.electronAPI){document.documentElement.style.setProperty('--titlebar-height','24px');document.documentElement.style.setProperty('--traffic-light-area','82px')}` }} />
        </Head>
        <body className="antialiased">
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
