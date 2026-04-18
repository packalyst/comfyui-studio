import { useState, useRef, useEffect } from 'react';

interface Props {
  content: string;
  children: React.ReactNode;
}

export default function Tooltip({ content, children }: Props) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      if (rect.top < 80) {
        setPosition('bottom');
      } else {
        setPosition('top');
      }
    }
  }, [visible]);

  if (!content) return <>{children}</>;

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          ref={tooltipRef}
          className={`absolute z-50 px-2.5 py-1.5 text-xs text-white bg-gray-900 rounded-md shadow-lg max-w-[200px] whitespace-normal pointer-events-none ${
            position === 'top'
              ? 'bottom-full mb-1.5 left-1/2 -translate-x-1/2'
              : 'top-full mt-1.5 left-1/2 -translate-x-1/2'
          }`}
        >
          {content}
          <div
            className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45 ${
              position === 'top' ? '-bottom-1' : '-top-1'
            }`}
          />
        </div>
      )}
    </div>
  );
}
