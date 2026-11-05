import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CardProps {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
}

export function Card({ children, className, elevated = false }: CardProps) {
  return (
    <div className={cn(elevated ? 'm3-card-elevated' : 'm3-card', 'p-5', className)}>
      {children}
    </div>
  );
}

interface SectionTitleProps {
  children: ReactNode;
  className?: string;
}

export function SectionTitle({ children, className }: SectionTitleProps) {
  return (
    <div
      className={cn(
        'text-xs font-bold uppercase tracking-wider text-neutral-50 mb-3 pb-2 border-b border-neutral-90/50',
        className
      )}
    >
      {children}
    </div>
  );
}

interface FieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, children, className }: FieldProps) {
  return (
    <div className={className}>
      <label className="m3-label block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  style?: React.CSSProperties;
}

export function Select({ value, onChange, options, className, style }: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={style}
      className={cn('m3-field cursor-pointer', className)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface InputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  readOnly = false,
  className,
  style,
}: InputProps) {
  return (
    <input
      type={type}
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={style}
      className={cn('m3-field', readOnly && 'bg-surface-container text-neutral-50', className)}
    />
  );
}
