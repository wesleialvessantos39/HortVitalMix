import React, { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  id: string;
}

export const Card: React.FC<CardProps> = ({ id, className = '', children, ...props }) => {
  return (
    <div
      id={id}
      className={cn('rounded-xl border border-zinc-200 bg-white shadow-xs', className)}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<CardProps> = ({ id, className = '', children, ...props }) => {
  return (
    <div
      id={id}
      className={cn('p-6 border-b border-zinc-100 flex flex-col gap-1.5', className)}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardContent: React.FC<CardProps> = ({ id, className = '', children, ...props }) => {
  return (
    <div id={id} className={cn('p-6', className)} {...props}>
      {children}
    </div>
  );
};

export const CardFooter: React.FC<CardProps> = ({ id, className = '', children, ...props }) => {
  return (
    <div
      id={id}
      className={cn('p-6 pt-0 border-t border-zinc-100 mt-4 flex items-center', className)}
      {...props}
    >
      {children}
    </div>
  );
};
