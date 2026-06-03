import { Button } from '@/components/ui/Button';
import { SCard, SRow } from '@/components/settings/SettingsCard';

export function DangerSection() {
  return (
    <SCard title="Danger zone">
      <SRow label="Sign out everywhere" desc="End all active sessions on every device.">
        <Button variant="ghost">Sign out all</Button>
      </SRow>
      <SRow label="Delete workspace" desc="Permanently remove the default workspace, all sources, wiki pages and chats." last>
        <Button variant="danger" icon="trash">Delete workspace</Button>
      </SRow>
    </SCard>
  );
}
