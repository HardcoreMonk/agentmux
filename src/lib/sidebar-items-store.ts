import fs from 'fs/promises';
import path from 'path';
import { getDataDir } from '@/lib/app-identity';

interface ISidebarItem {
  id: string;
  name: string;
  icon: string;
  url: string;
  enabled: boolean;
  labelKey?: 'notes' | 'stats' | 'sessionExplorer' | 'governance';
}

interface ISidebarItemsFile {
  custom: ISidebarItem[];
  disabledBuiltinIds: string[];
  order: string[];
}

interface ISidebarItemsData {
  builtins: ISidebarItem[];
  custom: ISidebarItem[];
  order: string[];
}

const BASE_DIR = getDataDir();
const FILE_PATH = path.join(BASE_DIR, 'sidebar-items.json');

const BUILTIN_ITEMS: ISidebarItem[] = [
  { id: 'builtin-notes', name: 'Notes', icon: 'FileText', url: '/reports', enabled: true },
  { id: 'builtin-stats', name: 'Stats', icon: 'BarChart3', url: '/stats', enabled: true },
  { id: 'builtin-session-explorer', name: 'Session Explorer', icon: 'Search', url: '/sessions', enabled: true },
  { id: 'builtin-governance', name: 'Project Governance', icon: 'ShieldCheck', url: '/governance', enabled: true },
];

const BUILTIN_ITEM_LABEL_KEYS: Record<string, 'notes' | 'stats' | 'sessionExplorer' | 'governance'> = {
  'builtin-notes': 'notes',
  'builtin-stats': 'stats',
  'builtin-session-explorer': 'sessionExplorer',
  'builtin-governance': 'governance',
};

const readSidebarItems = async (): Promise<ISidebarItemsData> => {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as ISidebarItemsFile;
    return buildData(parsed);
  } catch {
    return buildData({ custom: [], disabledBuiltinIds: [], order: [] });
  }
};

const buildData = (file: ISidebarItemsFile): ISidebarItemsData => {
  const disabledSet = new Set(file.disabledBuiltinIds ?? []);
  const builtins = BUILTIN_ITEMS.map((b) => ({
    ...b,
    enabled: !disabledSet.has(b.id),
    labelKey: BUILTIN_ITEM_LABEL_KEYS[b.id],
  }));
  const custom = (file.custom ?? []).map((c) => ({ ...c }));
  const order = file.order ?? [];
  return { builtins, custom, order };
};

const writeSidebarItems = async (data: ISidebarItemsFile): Promise<void> => {
  await fs.mkdir(BASE_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
};

export { readSidebarItems, writeSidebarItems, BUILTIN_ITEMS, BUILTIN_ITEM_LABEL_KEYS };
export type { ISidebarItem, ISidebarItemsFile, ISidebarItemsData };
