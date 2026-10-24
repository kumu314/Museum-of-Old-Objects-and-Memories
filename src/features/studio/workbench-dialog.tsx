import { useEffect, useId, useRef, type ReactNode } from 'react';

export function WorkbenchDialog({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { element.close(); return; }
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, [open]);
  return <dialog ref={dialog} className="workbench-dialog" aria-labelledby={headingId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="workbench-dialog-heading"><h2 id={headingId}>{title}</h2><button type="button" className="wb-secondary" onClick={onClose} aria-label={`关闭${title}`}>关闭</button></header>
    <div className="workbench-dialog-body">{children}</div>
  </dialog>;
}
