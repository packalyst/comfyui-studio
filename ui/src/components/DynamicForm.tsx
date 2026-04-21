import type { FormInput } from '../types';
import FormField from './FormField';

interface Props {
  inputs: FormInput[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}

export default function DynamicForm({ inputs, values, onChange }: Props) {
  const handleFieldChange = (id: string, value: unknown) => {
    onChange({ ...values, [id]: value });
  };

  if (inputs.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-4">No parameters for this template.</p>
    );
  }

  return (
    <div className="space-y-4">
      {inputs.map(input => (
        <FormField
          key={input.id}
          input={input}
          value={values[input.id] ?? input.default ?? (input.type === 'toggle' ? false : undefined)}
          onChange={val => handleFieldChange(input.id, val)}
        />
      ))}
    </div>
  );
}
