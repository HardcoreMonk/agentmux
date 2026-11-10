import { useEffect, useState } from 'react';
import { AGENT_BOOT_RECOVER_MS } from '@/lib/agent-boot-display';

// Returns 0 until the boot display has been active for AGENT_BOOT_RECOVER_MS, then that value.
// A single timeout drives one re-render; going inactive resets it.
const useAgentBootElapsed = (active: boolean): number => {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setExpired(true), AGENT_BOOT_RECOVER_MS);
    return () => { clearTimeout(timer); setExpired(false); };
  }, [active]);

  return active && expired ? AGENT_BOOT_RECOVER_MS : 0;
};

export default useAgentBootElapsed;
