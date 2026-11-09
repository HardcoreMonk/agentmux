import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hardcoremonk.codexmux',
  appName: 'agentmux',
  webDir: 'android-web',
  server: {
    cleartext: true,
    allowNavigation: [
      '*.ts.net',
      '*.*.ts.net',
      'localhost',
      '127.0.0.1',
      '10.0.2.2',
      '100.*.*.*',
      '10.*.*.*',
      '172.*.*.*',
      '192.168.*.*',
    ],
  },
  plugins: {
    CapacitorCookies: {
      enabled: true,
    },
  },
};

export default config;
