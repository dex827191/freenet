import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  return { toasts, showToast };
}

interface ToastContainerProps {
  toasts: Toast[];
}

export function ToastContainer({ toasts }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-[2000] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const colors = {
    success: 'bg-success-90 text-success-20 border-success-60/30',
    error: 'bg-error-90 text-error-20 border-error-60/30',
    info: 'bg-primary-90 text-primary-20 border-primary-60/30',
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-m3-md border px-4 py-3 text-sm font-medium shadow-lg transition-all duration-300',
        colors[toast.type],
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      )}
    >
      <span className="flex-1">{toast.message}</span>
      <X size={16} className="opacity-60" />
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-neutral-10/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative m3-card-elevated w-full max-w-sm p-6 animate-scale-in">
        <h2 className="text-lg font-bold text-neutral-10 mb-2">{title}</h2>
        <p className="text-sm text-neutral-60 mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <button className="m3-btn m3-btn-text state-layer" onClick={onCancel}>
            Batal
          </button>
          <button
            className="m3-btn m3-btn-filled state-layer bg-error-40 hover:bg-error-50"
            onClick={onConfirm}
          >
            Konfirmasi
          </button>
        </div>
      </div>
    </div>
  );
}

interface PromptDialogProps {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  label,
  placeholder,
  defaultValue = '',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-neutral-10/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative m3-card-elevated w-full max-w-md p-6 animate-scale-in">
        <h2 className="text-lg font-bold text-neutral-10 mb-4">{title}</h2>
        {label && <label className="m3-label block mb-1.5">{label}</label>}
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="m3-field w-full mb-4 min-h-[80px] resize-y"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button className="m3-btn m3-btn-text state-layer" onClick={onCancel}>
            Batal
          </button>
          <button
            className="m3-btn m3-btn-filled state-layer"
            onClick={() => onConfirm(value.trim())}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
