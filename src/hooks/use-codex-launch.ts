import { useState } from 'react';

interface ILaunchState {
  tabId: string | null;
  prev: boolean | null;
  launchKey: number;
}

interface IUseCodexLaunchReturn {
  launchKey: number;
  // True once this screen has seen the agent process start, as opposed to opening on a running one.
  starting: boolean;
}

// Counts launches of the tab's agent process: each change from a non-true value to true bumps launchKey.
const useCodexLaunch = (tabId: string | null, agentProcess: boolean | null): IUseCodexLaunchReturn => {
  const [state, setState] = useState<ILaunchState>({ tabId, prev: agentProcess, launchKey: 0 });
  let current = state;
  if (state.tabId !== tabId) {
    current = { tabId, prev: agentProcess, launchKey: 0 };
    setState(current);
  } else if (state.prev !== agentProcess) {
    current = {
      ...state,
      prev: agentProcess,
      launchKey: agentProcess === true ? state.launchKey + 1 : state.launchKey,
    };
    setState(current);
  }
  return { launchKey: current.launchKey, starting: current.launchKey > 0 };
};

export default useCodexLaunch;
