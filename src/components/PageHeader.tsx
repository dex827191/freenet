import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, icon, action, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between mb-5', className)}>
      <div className="flex items-center gap-3">
        {icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-m3-md bg-primary-95 text-primary-40">
            {icon}
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-neutral-10">{title}</h1>
          {subtitle && (
            <p className="text-sm text-neutral-60 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}
