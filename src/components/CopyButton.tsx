import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  variant?: 'icon' | 'text';
}

export function CopyButton({
  text,
  label = 'Copy',
  className,
  disabled = false,
  variant = 'text',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (disabled) return;
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [text, disabled]);

  if (variant === 'icon') {
    return (
      <button
        onClick={handleCopy}
        disabled={disabled}
        className={cn(
          'm3-btn-text state-layer p-2 rounded-m3-full',
          copied ? 'text-success-60' : 'text-primary-50',
          disabled && 'opacity-40 pointer-events-none',
          className
        )}
        aria-label={label}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      disabled={disabled}
      className={cn(
        'm3-btn m3-btn-outlined state-layer text-xs',
        copied && 'text-success-60 border-success-60',
        disabled && 'opacity-40 pointer-events-none',
        className
      )}
    >
      {copied ? (
        <>
          <Check size={14} /> Done
        </>
      ) : (
        <>
          <Copy size={14} /> {label}
        </>
      )}
    </button>
  );
}
