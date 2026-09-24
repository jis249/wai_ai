import React, { useState } from 'react'
import { Input, type InputProps } from '../ui/Input'
import { IconButton } from '../ui/IconButton'
import { Eye, EyeOff } from '../ui/icons'

export type PasswordInputProps = Omit<InputProps, 'type'>

/** Password field with a show/hide toggle. Pass `autoComplete` ("current-password" / "new-password"). */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, disabled, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        className={['pr-10', className].filter(Boolean).join(' ')}
        {...rest}
      />
      <IconButton
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        icon={visible ? <EyeOff /> : <Eye />}
        size="sm"
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
        // Label height (text-sm + mb-1.5) offsets the button onto the input row.
        className={rest.label != null ? 'absolute right-1.5 top-[1.9rem]' : 'absolute right-1.5 top-1.5'}
      />
    </div>
  )
})
