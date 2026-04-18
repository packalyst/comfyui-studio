interface Props {
  progress: number;
  status?: string;
}

export default function ProgressBar({ progress, status }: Props) {
  return (
    <div className="w-full">
      {status && (
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{status}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      )}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    </div>
  );
}
