import React from 'react';
import { Layers } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface EmptyStateProps {
  id: string;
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  id,
  icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div
      id={id}
      className={cn(
        'flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 mb-4">
        {icon || <Layers className="w-6 h-6" aria-hidden="true" />}
      </div>
      <h3 className="text-base font-semibold text-zinc-900 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-zinc-500 max-w-sm mb-6 leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
};
