import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, maxWidth = 'max-w-md' }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-neutral-10/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative m3-card-elevated w-full p-6 animate-scale-in',
          maxWidth
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-neutral-10">{title}</h2>
          <button
            onClick={onClose}
            className="m3-btn-text state-layer p-2 rounded-m3-full text-neutral-50"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
