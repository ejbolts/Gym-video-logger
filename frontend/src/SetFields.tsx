import { useId } from 'react';
import { RPE_OPTIONS, steppedValue, type SetKind } from './setFieldValues';

const SET_TYPES: Array<{ value: SetKind; label: string }> = [
  { value: 'normal', label: 'Working' },
  { value: 'warmup', label: 'Warm-up' },
  { value: 'drop', label: 'Drop set' },
];

/** A labelled number field with large − / + buttons for one-handed adjustments. */
export function StepperInput({
  label,
  value,
  onChange,
  step,
  min = 0,
  unit,
  decimal = false,
  autoFocus = false,
  selectOnFocus = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step: number;
  min?: number;
  unit?: string;
  decimal?: boolean;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
}) {
  const pattern = decimal ? /^\d*(?:[.,]\d*)?$/ : /^\d*$/;
  return (
    <div className="stepper-field">
      <span className="stepper-label" aria-hidden="true">
        {label}
      </span>
      <div className="stepper-control">
        <button
          type="button"
          className="stepper-button"
          aria-label={`Decrease ${label.toLowerCase()} by ${step}`}
          onClick={() => onChange(steppedValue(value, -step, min))}
        >
          −
        </button>
        <span className="stepper-input">
          <input
            aria-label={label}
            autoFocus={autoFocus}
            inputMode={decimal ? 'decimal' : 'numeric'}
            value={value}
            onFocus={(event) => {
              if (selectOnFocus && event.currentTarget.value) event.currentTarget.select();
            }}
            onChange={(event) => {
              const next = event.target.value;
              if (pattern.test(next)) onChange(decimal ? next.replace(',', '.') : next);
            }}
          />
          {unit && <b aria-hidden="true">{unit}</b>}
        </span>
        <button
          type="button"
          className="stepper-button"
          aria-label={`Increase ${label.toLowerCase()} by ${step}`}
          onClick={() => onChange(steppedValue(value, step, min))}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** RPE as tappable chips; the first chip clears the value. */
export function RpeChips({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const labelId = useId();
  return (
    <div className="chip-field">
      <span className="stepper-label" id={labelId}>
        RPE
      </span>
      <div className="rpe-chips" role="radiogroup" aria-labelledby={labelId}>
        {(['', ...RPE_OPTIONS.map(String)] as string[]).map((option) => {
          const selected = value === option;
          return (
            <button
              key={option || 'none'}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option ? `RPE ${option}` : 'No RPE'}
              className={selected ? 'active' : ''}
              autoFocus={autoFocus && selected}
              onClick={() => onChange(option)}
            >
              {option || '–'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SetTypeSegments({
  value,
  onChange,
  autoFocus = false,
}: {
  value: SetKind;
  onChange: (value: SetKind) => void;
  autoFocus?: boolean;
}) {
  const labelId = useId();
  return (
    <div className="chip-field">
      <span className="stepper-label" id={labelId}>
        Type
      </span>
      <div
        className="segmented-control set-type-segments"
        role="radiogroup"
        aria-labelledby={labelId}
      >
        {SET_TYPES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? 'active' : ''}
            autoFocus={autoFocus && value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
