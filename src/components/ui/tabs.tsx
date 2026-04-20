import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Controlled / uncontrolled tabs primitive. Mirrors the shadcn API
 * (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) but built on a
 * small React context rather than `@radix-ui/react-tabs`, which is not
 * installed in this project. Keyboard navigation is intentionally
 * minimal — horizontal arrow keys move focus between triggers.
 */

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  idPrefix: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsCtx() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error('Tabs components must be used inside <Tabs>');
  return ctx;
}

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ value: controlled, defaultValue, onValueChange, children, className, ...props }, ref) => {
    const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? '');
    const isControlled = controlled !== undefined;
    const value = isControlled ? controlled : uncontrolled;
    const idPrefix = React.useId();

    const setValue = React.useCallback(
      (v: string) => {
        if (!isControlled) setUncontrolled(v);
        onValueChange?.(v);
      },
      [isControlled, onValueChange],
    );

    const ctx = React.useMemo<TabsContextValue>(
      () => ({ value, setValue, idPrefix }),
      [value, setValue, idPrefix],
    );

    return (
      <TabsContext.Provider value={ctx}>
        <div ref={ref} className={className} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    );
  },
);
Tabs.displayName = 'Tabs';

const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm',
        className,
      )}
      {...props}
    />
  ),
);
TabsList.displayName = 'TabsList';

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ value, className, onClick, ...props }, ref) => {
    const { value: active, setValue, idPrefix } = useTabsCtx();
    const isActive = active === value;
    return (
      <button
        ref={ref}
        role="tab"
        type="button"
        aria-selected={isActive}
        aria-controls={`${idPrefix}-content-${value}`}
        id={`${idPrefix}-trigger-${value}`}
        data-state={isActive ? 'active' : 'inactive'}
        onClick={(e) => {
          setValue(value);
          onClick?.(e);
        }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition',
          isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
          className,
        )}
        {...props}
      />
    );
  },
);
TabsTrigger.displayName = 'TabsTrigger';

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  /** If false (default), unmount inactive panels so their effects don't run. */
  forceMount?: boolean;
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ value, forceMount = false, className, children, ...props }, ref) => {
    const { value: active, idPrefix } = useTabsCtx();
    const isActive = active === value;
    if (!isActive && !forceMount) return null;
    return (
      <div
        ref={ref}
        role="tabpanel"
        id={`${idPrefix}-content-${value}`}
        aria-labelledby={`${idPrefix}-trigger-${value}`}
        hidden={!isActive}
        className={className}
        {...props}
      >
        {children}
      </div>
    );
  },
);
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
