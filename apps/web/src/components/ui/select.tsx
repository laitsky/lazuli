/**
 * Select — native select with the app's compound API.
 *
 * The previous Radix Select wrapper could enter a maximum-update loop during
 * route renders in this app shell. This implementation keeps the existing
 * call-site shape while using the browser's stable native select control.
 */

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
  'aria-label'?: string;
}

interface SelectTriggerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

interface SelectValueProps {
  placeholder?: string;
}

interface SelectContentProps {
  children: React.ReactNode;
}

interface SelectItemProps {
  value: string;
  disabled?: boolean;
  children: React.ReactNode;
}

function nodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return '';
}

function collectOptions(children: React.ReactNode): SelectOption[] {
  const options: SelectOption[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as {
      value?: unknown;
      disabled?: boolean;
      children?: React.ReactNode;
    };

    if (typeof props.value === 'string') {
      options.push({
        value: props.value,
        label: nodeText(props.children).trim() || props.value,
        disabled: props.disabled,
      });
    }

    if (props.children) {
      options.push(...collectOptions(props.children));
    }
  });

  return options;
}

function findTriggerClassName(children: React.ReactNode): string | undefined {
  let className: string | undefined;

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || className) return;
    const props = child.props as { className?: string; children?: React.ReactNode };
    const displayName = (child.type as { displayName?: string }).displayName;

    if (displayName === 'SelectTrigger') {
      className = props.className;
      return;
    }

    if (props.children) {
      className = findTriggerClassName(props.children);
    }
  });

  return className;
}

function findPlaceholder(children: React.ReactNode): string | undefined {
  let placeholder: string | undefined;

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || placeholder) return;
    const props = child.props as { placeholder?: string; children?: React.ReactNode };

    if (typeof props.placeholder === 'string') {
      placeholder = props.placeholder;
      return;
    }

    if (props.children) {
      placeholder = findPlaceholder(props.children);
    }
  });

  return placeholder;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  disabled,
  children,
  'aria-label': ariaLabel,
}: SelectProps) {
  const options = React.useMemo(() => collectOptions(children), [children]);
  const triggerClassName = React.useMemo(() => findTriggerClassName(children), [children]);
  const placeholder = React.useMemo(() => findPlaceholder(children), [children]);
  const fallbackValue = value ?? defaultValue ?? '';

  return (
    <div className={cn('relative inline-flex', triggerClassName)}>
      <select
        value={fallbackValue}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder ?? 'Select option'}
        onChange={(event) => onValueChange?.(event.target.value)}
        className={cn(
          'h-full w-full appearance-none rounded-md border border-border bg-surface-1',
          'px-3 pr-8 text-sm text-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        {placeholder && fallbackValue === '' && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60"
        aria-hidden
      />
    </div>
  );
}

export function SelectGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function SelectValue(_props: SelectValueProps) {
  return null;
}

export const SelectTrigger = React.forwardRef<HTMLDivElement, SelectTriggerProps>(
  ({ children: _children, ...props }, ref) => <div ref={ref} {...props} />
);
SelectTrigger.displayName = 'SelectTrigger';

export function SelectContent({ children }: SelectContentProps) {
  return <>{children}</>;
}

export const SelectLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, ...props }, ref) => (
    <div ref={ref} {...props}>
      {children}
    </div>
  )
);
SelectLabel.displayName = 'SelectLabel';

export function SelectItem(_props: SelectItemProps) {
  return null;
}

export const SelectSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>((props, ref) => <div ref={ref} {...props} />);
SelectSeparator.displayName = 'SelectSeparator';
