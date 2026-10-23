import { useState } from 'react';
import { Download, FileJson, FileText, FileType } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/overlay';
import { downloadFile } from '@/lib/api';

export function ReportMenu({ base, disabled }: { base: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const go = async (format: 'json' | 'md' | 'pdf') => {
    setBusy(true);
    try {
      const name = await downloadFile(`${base}/report?format=${format}`);
      toast.success(`Downloaded ${name}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" loading={busy} disabled={disabled} icon={<Download className="size-4" />}>
          Export report
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => go('pdf')}>
          <FileType className="size-4" /> PDF report
        </MenuItem>
        <MenuItem onSelect={() => go('md')}>
          <FileText className="size-4" /> Markdown summary
        </MenuItem>
        <MenuItem onSelect={() => go('json')}>
          <FileJson className="size-4" /> JSON (machine-readable)
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
