export function SetDialogKeyboardAction({
  label,
  submit = false,
  form,
  onClick,
}: {
  label: 'Add' | 'Save';
  submit?: boolean;
  form?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type={submit ? 'submit' : 'button'}
      form={form}
      className="set-dialog-keyboard-action"
      aria-label={`${label} set`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
